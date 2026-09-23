#!/usr/bin/env bash
# Deploys Radio Net Trainer to ECS Fargate: one task, behind an
# HTTP-only ALB, using the default VPC and its public subnets.
#
# Review before running. Each step is idempotent-ish (uses --query to
# grab IDs of things it just created) but this isn't meant to be run
# unattended the first time through.
#
# Why one task: session state (participants, queue, log) lives in the
# process's memory. A second task would have its own, disconnected
# state, so this pins desiredCount at 1 and accepts brief downtime on
# deploy rather than running two tasks during a rolling update.

set -euo pipefail

REGION="us-west-2"
APP_NAME="radio-net-trainer"
CLUSTER_NAME="$APP_NAME"
REPO_NAME="$APP_NAME"
FAMILY="$APP_NAME"
SERVICE_NAME="${APP_NAME}-svc"
LOG_GROUP="/ecs/${APP_NAME}"
CONTAINER_PORT=3000

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}"

echo "== 1. ECR repo =="
aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPO_NAME" --region "$REGION"

echo "== 2. Build and push image =="
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker build -t "$REPO_NAME:latest" ..
docker tag "$REPO_NAME:latest" "$ECR_URI:latest"
docker push "$ECR_URI:latest"

echo "== 3. CloudWatch log group =="
aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" \
  --query "logGroups[?logGroupName=='${LOG_GROUP}']" --output text | grep -q "$LOG_GROUP" \
  || aws logs create-log-group --log-group-name "$LOG_GROUP" --region "$REGION"

echo "== 4. ECS cluster =="
aws ecs describe-clusters --clusters "$CLUSTER_NAME" --region "$REGION" \
  --query "clusters[?status=='ACTIVE']" --output text | grep -q "$CLUSTER_NAME" \
  || aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$REGION"

echo "== 5. Task execution role =="
EXEC_ROLE_NAME="${APP_NAME}-execution-role"
if ! aws iam get-role --role-name "$EXEC_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$EXEC_ROLE_NAME" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "ecs-tasks.amazonaws.com"}, "Action": "sts:AssumeRole"}]
  }'
  aws iam attach-role-policy --role-name "$EXEC_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
fi
EXEC_ROLE_ARN=$(aws iam get-role --role-name "$EXEC_ROLE_NAME" --query 'Role.Arn' --output text)

echo "== 6. Default VPC and public subnets =="
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --region "$REGION" --query 'Vpcs[0].VpcId' --output text)
SUBNET_IDS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" --region "$REGION" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')

echo "== 7. Security groups =="
ALB_SG_ID=$(aws ec2 create-security-group --group-name "${APP_NAME}-alb" \
  --description "ALB ingress for ${APP_NAME}" --vpc-id "$VPC_ID" --region "$REGION" \
  --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG_ID" --protocol tcp --port 80 \
  --cidr 0.0.0.0/0 --region "$REGION"

TASK_SG_ID=$(aws ec2 create-security-group --group-name "${APP_NAME}-task" \
  --description "Task ingress for ${APP_NAME}" --vpc-id "$VPC_ID" --region "$REGION" \
  --query 'GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$TASK_SG_ID" --protocol tcp --port "$CONTAINER_PORT" \
  --source-group "$ALB_SG_ID" --region "$REGION"

echo "== 8. ALB + target group + listener =="
IFS=',' read -ra SUBNET_ID_ARRAY <<< "$SUBNET_IDS"
ALB_ARN=$(aws elbv2 create-load-balancer --name "${APP_NAME}-alb" \
  --subnets "${SUBNET_ID_ARRAY[@]}" --security-groups "$ALB_SG_ID" \
  --scheme internet-facing --type application --region "$REGION" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" --region "$REGION" \
  --query 'LoadBalancers[0].DNSName' --output text)

TG_ARN=$(aws elbv2 create-target-group --name "${APP_NAME}-tg" \
  --protocol HTTP --port "$CONTAINER_PORT" --vpc-id "$VPC_ID" --target-type ip \
  --health-check-path / --region "$REGION" \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn="$TG_ARN" --region "$REGION" >/dev/null

echo "ALB address: http://${ALB_DNS}"

echo "== 9. Task definition =="
cat > /tmp/task-def.json <<EOF
{
  "family": "${FAMILY}",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "${EXEC_ROLE_ARN}",
  "containerDefinitions": [{
    "name": "app",
    "image": "${ECR_URI}:latest",
    "portMappings": [{"containerPort": ${CONTAINER_PORT}, "protocol": "tcp"}],
    "environment": [
      {"name": "PORT", "value": "${CONTAINER_PORT}"},
      {"name": "ALLOWED_ORIGINS", "value": "http://${ALB_DNS}"}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "${LOG_GROUP}",
        "awslogs-region": "${REGION}",
        "awslogs-stream-prefix": "app"
      }
    }
  }]
}
EOF
aws ecs register-task-definition --cli-input-json file:///tmp/task-def.json --region "$REGION" >/dev/null

echo "== 10. ECS service (desiredCount pinned at 1) =="
aws ecs create-service \
  --cluster "$CLUSTER_NAME" \
  --service-name "$SERVICE_NAME" \
  --task-definition "$FAMILY" \
  --desired-count 1 \
  --launch-type FARGATE \
  --deployment-configuration "maximumPercent=100,minimumHealthyPercent=0" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNET_IDS}],securityGroups=[${TASK_SG_ID}],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=${TG_ARN},containerName=app,containerPort=${CONTAINER_PORT}" \
  --region "$REGION"

echo
echo "Done. Once the task passes its health check, the app is at:"
echo "  http://${ALB_DNS}"
echo
echo "Set INSTRUCTOR_PASSCODE by adding it to the container's \"environment\""
echo "array above (or better, via Secrets Manager / SSM ParameterStore and"
echo "a \"secrets\" entry instead of plaintext)."

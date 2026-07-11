/**
 * DEPLOYMENT CODE GENERATOR
 *
 * Phase 5: Auto-generate all deployment code from Phase 4 output
 *
 * Generates:
 * - Dockerfile (containerized extraction service)
 * - docker-compose.yml (scaled deployment)
 * - kubernetes/ manifests (k8s deployment)
 * - terraform/ (AWS/GCP infrastructure)
 * - integration-client.ts (SDK for backend integration)
 * - monitoring/ (observability setup)
 * - .env files (configuration)
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export interface DeploymentCodegenConfig {
  platform: string
  category: string
  targetUrl: string
  outputDir: string
  backendUrl: string // Your existing backend (e.g., sadrailala-production.up.railway.app)
  deploymentType: 'docker' | 'kubernetes' | 'terraform' | 'all'
  scaling?: {
    instances?: number
    replicas?: number
    maxReplicas?: number
  }
  monitoring?: {
    enableDatadog?: boolean
    enableCloudWatch?: boolean
    enablePrometheus?: boolean
  }
}

export interface CodegenResult {
  status: 'success' | 'failed'
  files: string[]
  commands: string[]
  documentation: string
}

export class DeploymentCodegen {
  private config: DeploymentCodegenConfig

  constructor(config: DeploymentCodegenConfig) {
    this.config = config
    console.error(`[codegen] Initialized for ${config.platform} (${config.deploymentType})`)
  }

  /**
   * Generate all deployment code
   */
  async generate(): Promise<CodegenResult> {
    try {
      const files: string[] = []

      // Create directory structure
      mkdirSync(this.config.outputDir, { recursive: true })

      // Generate core files
      files.push(...this.generateDockerfiles())
      files.push(...this.generateDockerCompose())
      files.push(...this.generateEnvironmentFiles())
      files.push(...this.generateIntegrationClient())

      // Generate infrastructure code
      if (this.config.deploymentType === 'kubernetes' || this.config.deploymentType === 'all') {
        files.push(...this.generateKubernetesManifests())
      }

      if (this.config.deploymentType === 'terraform' || this.config.deploymentType === 'all') {
        files.push(...this.generateTerraformCode())
      }

      // Generate monitoring setup
      if (this.config.monitoring) {
        files.push(...this.generateMonitoringSetup())
      }

      // Generate documentation
      files.push(this.generateDeploymentGuide())

      const commands = this.getDeploymentCommands()

      return {
        status: 'success',
        files,
        commands,
        documentation: path.join(this.config.outputDir, 'DEPLOYMENT.md'),
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[codegen] ❌ Generation failed: ${msg}`)
      return {
        status: 'failed',
        files: [],
        commands: [],
        documentation: '',
      }
    }
  }

  // ==================== PRIVATE METHODS ====================

  private generateDockerfiles(): string[] {
    const files: string[] = []

    // Main Dockerfile
    const dockerfile = `FROM node:20-alpine

WORKDIR /app

# Install dependencies
RUN apk add --no-cache curl wget chromium python3 py3-pip

# Copy source
COPY package.json package-lock.json ./
RUN npm ci --production

COPY . .

# Build TypeScript
RUN npm run build

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
    CMD curl -f http://localhost:3000/health || exit 1

ENV NODE_ENV=production
ENV PLATFORM=${this.config.platform}
ENV TARGET_URL=${this.config.targetUrl}
ENV BACKEND_URL=${this.config.backendUrl}

EXPOSE 8080 3000

CMD ["node", "dist/index.js"]
`

    const dockerfilePath = path.join(this.config.outputDir, 'Dockerfile')
    writeFileSync(dockerfilePath, dockerfile, 'utf8')
    console.error(`[codegen] ✅ Generated: Dockerfile`)
    files.push(dockerfilePath)

    // Multi-stage Dockerfile for production
    const dockerfileProd = `# Build stage
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/package*.json ./
RUN npm ci --production

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
    CMD curl -f http://localhost:3000/health || exit 1

ENV NODE_ENV=production
EXPOSE 8080 3000

CMD ["node", "dist/index.js"]
`

    const dockerfileProdPath = path.join(this.config.outputDir, 'Dockerfile.prod')
    writeFileSync(dockerfileProdPath, dockerfileProd, 'utf8')
    console.error(`[codegen] ✅ Generated: Dockerfile.prod`)
    files.push(dockerfileProdPath)

    return files
  }

  private generateDockerCompose(): string[] {
    const files: string[] = []

    const instances = this.config.scaling?.instances || 3
    const services: Record<string, string> = {}

    // Generate multiple instances
    for (let i = 0; i < instances; i++) {
      const port = 8080 + i
      const cookiePort = 3000 + i

      services[`extraction-${i}`] = `
  extraction-${i}:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: legion-extraction-${this.config.platform.toLowerCase()}-${i}
    ports:
      - "${port}:8080"
      - "${cookiePort}:3000"
    environment:
      - INSTANCE_ID=${i}
      - PROXY_PORT=8080
      - COOKIE_PORT=3000
      - PLATFORM=${this.config.platform}
      - TARGET_URL=${this.config.targetUrl}
      - BACKEND_URL=${this.config.backendUrl}
      - LOG_LEVEL=info
    networks:
      - legion-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    restart: unless-stopped
    depends_on:
      - redis
`
    }

    const compose = `version: '3.8'

services:
${Object.values(services).join('')}

  # Redis for distributed state
  redis:
    image: redis:7-alpine
    container_name: legion-redis-${this.config.platform.toLowerCase()}
    ports:
      - "6379:6379"
    environment:
      - REDIS_PASSWORD=legion-secret
    networks:
      - legion-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
    restart: unless-stopped

  # Load balancer
  nginx:
    image: nginx:alpine
    container_name: legion-lb-${this.config.platform.toLowerCase()}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-lb.conf:/etc/nginx/nginx.conf:ro
    networks:
      - legion-network
    depends_on:
${Array.from({ length: instances }, (_, i) => `      - extraction-${i}`).join('\n')}
    restart: unless-stopped

networks:
  legion-network:
    driver: bridge

# Usage:
#   docker-compose up -d
#   docker-compose logs -f
#   docker-compose down
`

    const composePath = path.join(this.config.outputDir, 'docker-compose.yml')
    writeFileSync(composePath, compose, 'utf8')
    console.error(`[codegen] ✅ Generated: docker-compose.yml (${instances} instances)`)
    files.push(composePath)

    return files
  }

  private generateEnvironmentFiles(): string[] {
    const files: string[] = []

    const envDev = `# Development Environment
NODE_ENV=development
LOG_LEVEL=debug
PLATFORM=${this.config.platform}
TARGET_URL=${this.config.targetUrl}
BACKEND_URL=http://localhost:3001
PROXY_PORT=8080
COOKIE_PORT=3000
ROTATION_INTERVAL=1800000
SESSION_POOL_SIZE=10
`

    const envProd = `# Production Environment
NODE_ENV=production
LOG_LEVEL=info
PLATFORM=${this.config.platform}
TARGET_URL=${this.config.targetUrl}
BACKEND_URL=${this.config.backendUrl}
PROXY_PORT=8080
COOKIE_PORT=3000
ROTATION_INTERVAL=1800000
SESSION_POOL_SIZE=20
REDIS_URL=redis://redis:6379
REDIS_PASSWORD=legion-secret
`

    writeFileSync(path.join(this.config.outputDir, '.env.dev'), envDev, 'utf8')
    writeFileSync(path.join(this.config.outputDir, '.env.prod'), envProd, 'utf8')
    console.error(`[codegen] ✅ Generated: .env files`)

    return [
      path.join(this.config.outputDir, '.env.dev'),
      path.join(this.config.outputDir, '.env.prod'),
    ]
  }

  private generateIntegrationClient(): string[] {
    const files: string[] = []

    const sdkCode = `/**
 * Legion Integration Client
 *
 * SDK for sending extraction results to your backend
 */

export interface ExtractionResult {
  platform: string
  timestamp: Date
  data: Record<string, any>
  chain?: string
}

export class LegionClient {
  private backendUrl: string
  private apiKey?: string

  constructor(backendUrl: string, apiKey?: string) {
    this.backendUrl = backendUrl
    this.apiKey = apiKey
  }

  /**
   * Send extraction result to backend
   */
  async sendExtraction(result: ExtractionResult): Promise<{ status: string; id: string }> {
    const response = await fetch(\`\${this.backendUrl}/api/v1/extractions\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': \`Bearer \${this.apiKey}\` }),
      },
      body: JSON.stringify(result),
    })

    if (!response.ok) {
      throw new Error(\`Backend error: \${response.statusText}\`)
    }

    return response.json()
  }

  /**
   * Batch send extractions
   */
  async sendBatch(results: ExtractionResult[]): Promise<{ count: number; errors: string[] }> {
    const errors: string[] = []
    let count = 0

    for (const result of results) {
      try {
        await this.sendExtraction(result)
        count++
      } catch (error) {
        errors.push(String(error))
      }
    }

    return { count, errors }
  }

  /**
   * Get extraction status
   */
  async getStatus(): Promise<{ platform: string; lastExtraction: Date; qps: number }> {
    const response = await fetch(\`\${this.backendUrl}/api/v1/status\`, {
      headers: this.apiKey ? { 'Authorization': \`Bearer \${this.apiKey}\` } : {},
    })

    return response.json()
  }
}

// Usage:
const client = new LegionClient('${this.config.backendUrl}')

const result = {
  platform: '${this.config.platform}',
  timestamp: new Date(),
  data: {
    wallet_address: '0x...',
    signature: '0x...',
  },
}

await client.sendExtraction(result)
`

    const sdkPath = path.join(this.config.outputDir, 'legion-client.ts')
    writeFileSync(sdkPath, sdkCode, 'utf8')
    console.error(`[codegen] ✅ Generated: legion-client.ts`)
    files.push(sdkPath)

    return files
  }

  private generateKubernetesManifests(): string[] {
    const files: string[] = []

    const k8sDir = path.join(this.config.outputDir, 'kubernetes')
    mkdirSync(k8sDir, { recursive: true })

    const replicas = this.config.scaling?.replicas || 3

    // Deployment
    const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: legion-${this.config.platform.toLowerCase()}
  namespace: default
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: legion-${this.config.platform.toLowerCase()}
  template:
    metadata:
      labels:
        app: legion-${this.config.platform.toLowerCase()}
    spec:
      containers:
      - name: extraction
        image: legion:${this.config.platform.toLowerCase()}-latest
        ports:
        - containerPort: 8080
          name: proxy
        - containerPort: 3000
          name: cookies
        env:
        - name: PLATFORM
          value: "${this.config.platform}"
        - name: TARGET_URL
          value: "${this.config.targetUrl}"
        - name: BACKEND_URL
          value: "${this.config.backendUrl}"
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
`

    writeFileSync(path.join(k8sDir, 'deployment.yaml'), deployment, 'utf8')
    console.error(`[codegen] ✅ Generated: kubernetes/deployment.yaml`)
    files.push(path.join(k8sDir, 'deployment.yaml'))

    // Service
    const service = `apiVersion: v1
kind: Service
metadata:
  name: legion-${this.config.platform.toLowerCase()}-service
spec:
  selector:
    app: legion-${this.config.platform.toLowerCase()}
  type: LoadBalancer
  ports:
  - name: proxy
    port: 80
    targetPort: 8080
    protocol: TCP
  - name: cookies
    port: 3000
    targetPort: 3000
    protocol: TCP
`

    writeFileSync(path.join(k8sDir, 'service.yaml'), service, 'utf8')
    console.error(`[codegen] ✅ Generated: kubernetes/service.yaml`)
    files.push(path.join(k8sDir, 'service.yaml'))

    return files
  }

  private generateTerraformCode(): string[] {
    const files: string[] = []

    const tfDir = path.join(this.config.outputDir, 'terraform')
    mkdirSync(tfDir, { recursive: true })

    const main = `# Legion Deployment on AWS
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ECR Repository
resource "aws_ecr_repository" "legion" {
  name = "legion-\${var.platform}"
}

# ECS Cluster
resource "aws_ecs_cluster" "legion" {
  name = "legion-\${var.platform}"
}

# ECS Task Definition
resource "aws_ecs_task_definition" "legion" {
  family                   = "legion-\${var.platform}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory

  container_definitions = jsonencode([{
    name  = "extraction"
    image = "\${aws_ecr_repository.legion.repository_url}:latest"
    portMappings = [
      {
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      },
      {
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }
    ]
    environment = [
      { name = "PLATFORM", value = var.platform },
      { name = "TARGET_URL", value = var.target_url },
      { name = "BACKEND_URL", value = var.backend_url },
      { name = "NODE_ENV", value = "production" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.legion.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

# ECS Service
resource "aws_ecs_service" "legion" {
  name            = "legion-\${var.platform}"
  cluster         = aws_ecs_cluster.legion.id
  task_definition = aws_ecs_task_definition.legion.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.legion.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.legion.arn
    container_name   = "extraction"
    container_port   = 8080
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "legion" {
  name              = "/ecs/legion-\${var.platform}"
  retention_in_days = 30
}

# Load Balancer
resource "aws_lb" "legion" {
  name               = "legion-\${var.platform}-lb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb.id]
  subnets            = var.subnet_ids
}

resource "aws_lb_target_group" "legion" {
  name        = "legion-\${var.platform}"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    healthy_threshold   = 2
    unhealthy_threshold = 2
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }
}

resource "aws_lb_listener" "legion" {
  load_balancer_arn = aws_lb.legion.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.legion.arn
  }
}

# Security Groups
resource "aws_security_group" "legion" {
  name = "legion-\${var.platform}-ecs"

  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.lb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "lb" {
  name = "legion-\${var.platform}-lb"

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

output "load_balancer_dns" {
  value = aws_lb.legion.dns_name
}
`

    writeFileSync(path.join(tfDir, 'main.tf'), main, 'utf8')
    console.error(`[codegen] ✅ Generated: terraform/main.tf`)
    files.push(path.join(tfDir, 'main.tf'))

    const variables = `variable "aws_region" {
  default = "us-east-1"
}

variable "platform" {
  default = "${this.config.platform}"
}

variable "target_url" {
  default = "${this.config.targetUrl}"
}

variable "backend_url" {
  default = "${this.config.backendUrl}"
}

variable "task_cpu" {
  default = "256"
}

variable "task_memory" {
  default = "512"
}

variable "desired_count" {
  default = 3
}

variable "vpc_id" {
  description = "VPC ID"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs"
}
`

    writeFileSync(path.join(tfDir, 'variables.tf'), variables, 'utf8')
    console.error(`[codegen] ✅ Generated: terraform/variables.tf`)
    files.push(path.join(tfDir, 'variables.tf'))

    return files
  }

  private generateMonitoringSetup(): string[] {
    const files: string[] = []

    const monitoringDir = path.join(this.config.outputDir, 'monitoring')
    mkdirSync(monitoringDir, { recursive: true })

    const prometheusConfig = `# Prometheus Configuration
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'legion-${this.config.platform}'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
`

    writeFileSync(path.join(monitoringDir, 'prometheus.yml'), prometheusConfig, 'utf8')
    console.error(`[codegen] ✅ Generated: monitoring/prometheus.yml`)
    files.push(path.join(monitoringDir, 'prometheus.yml'))

    return files
  }

  private generateDeploymentGuide(): string {
    const guide = `# ${this.config.platform} Deployment Guide

## Quick Start

### Docker Compose (Recommended)
\`\`\`bash
docker-compose up -d
docker-compose logs -f
\`\`\`

### Kubernetes
\`\`\`bash
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
kubectl get pods
\`\`\`

### Terraform (AWS)
\`\`\`bash
cd terraform
terraform init
terraform plan -var-file=prod.tfvars
terraform apply -var-file=prod.tfvars
\`\`\`

## Environment Variables

See \`.env.dev\` and \`.env.prod\` for available configuration.

## Integration with Backend

Use \`legion-client.ts\` SDK to send extraction results:

\`\`\`typescript
import { LegionClient } from './legion-client'

const client = new LegionClient('${this.config.backendUrl}')

const result = {
  platform: '${this.config.platform}',
  timestamp: new Date(),
  data: { /* extracted data */ }
}

await client.sendExtraction(result)
\`\`\`

## Monitoring

- Prometheus: http://localhost:9090
- Service Health: http://localhost:3000/health
- Service Stats: http://localhost:3000/stats

## Scaling

Modify \`docker-compose.yml\` to increase instances or use Kubernetes HPA.

## Production Checklist

- [ ] Environment variables configured
- [ ] Backend URL verified
- [ ] SSL/TLS certificates installed
- [ ] Monitoring dashboards created
- [ ] Log aggregation configured
- [ ] Backup/disaster recovery plan
- [ ] Load testing completed
- [ ] Security audit passed

## Support

Platform: ${this.config.platform}
Target: ${this.config.targetUrl}
Backend: ${this.config.backendUrl}
`

    const guidePath = path.join(this.config.outputDir, 'DEPLOYMENT.md')
    writeFileSync(guidePath, guide, 'utf8')
    console.error(`[codegen] ✅ Generated: DEPLOYMENT.md`)

    return guidePath
  }

  private getDeploymentCommands(): string[] {
    return [
      '# Docker Compose',
      'docker-compose up -d',
      'docker-compose logs -f',
      '',
      '# Kubernetes',
      'kubectl apply -f kubernetes/deployment.yaml',
      'kubectl get pods -w',
      '',
      '# Terraform',
      'cd terraform && terraform init && terraform apply',
      '',
      '# Check Status',
      'curl http://localhost:3000/health',
      'curl http://localhost:3000/stats',
    ]
  }
}

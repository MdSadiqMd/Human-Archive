set dotenv-load := false

pipeline_bin := "pipeline/bin/pipeline"
classifier_dir := "classifier"
output_dir := "output"
infra_dir := "infra"

# Build the Go pipeline binary
build:
    cd pipeline && go build -o bin/pipeline ./cmd/pipeline

# Install / sync Python classifier dependencies
install:
    cd {{classifier_dir}} && uv sync

# Download 1 video from S3 and classify frames into output/
# Available prefixes: ambulance_emt appliance_repair bakery bar camera_misplaced
#                     car_wash cleaning_service construction_site
run limit="1" prefix="bakery" dest_bucket="":
    env:
        DEST_BUCKET: "{{dest_bucket}}"
    #!/usr/bin/env bash
    mkdir -p {{output_dir}}
    cd pipeline && ./bin/pipeline \
        -limit {{limit}} \
        -prefix "{{prefix}}" \
        -base-fps 1 \
        -event-fps 5 \
        -dense-fps 10 \
        -context-s 3 \
        -max-frames-per-video 250 \
        -primary-conf 0.5 \
        -secondary-conf 0.15 \
        -presence-threshold 0.06 \
        -classifier-dir ../{{classifier_dir}} \
        -output ../{{output_dir}} \
        ${DEST_BUCKET:+-dest-bucket $DEST_BUCKET}

# Build then run
all: build run

# Classify a local video file directly (skips S3 download)
# Usage: just classify path/to/video.mp4
classify video:
    cd {{classifier_dir}} && uv run classify-video \
        "../{{video}}" \
        --out "../{{output_dir}}/$(basename {{video}} .mp4).json" \
        --frames-dir "../{{output_dir}}/$(basename {{video}} .mp4)" \
        --base-fps 1 \
        --event-fps 5 \
        --dense-fps 10 \
        --context-s 3 \
        --primary-conf 0.5 \
        --secondary-conf 0.15 \
        --presence-threshold 0.06

# Remove output frames (keeps report JSON)
clean-frames:
    find {{output_dir}} -name "*.jpg" -delete

# Remove all output
clean:
    rm -rf {{output_dir}}

# --- Backend / ingest ---

# Ingest pipeline output into the backend
ingest dir="./output":
    @echo "Fetching admin token..."
    TOKEN=$$(curl -s -X POST http://localhost:8080/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin@example.com","password":"admin123"}' \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))") && \
    echo "Ingesting {{dir}}..." && \
    curl -s -X POST http://localhost:8080/admin/ingest \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $$TOKEN" \
      -d '{"directory":"{{dir}}"}' | python3 -m json.tool

# Run pipeline then ingest
run-and-ingest limit="1" prefix="bakery":
    @just run {{limit}} {{prefix}} && just ingest

# --- Local Development ---

# Start local dev environment (postgres + backend)
dev:
    docker compose up -d --build

# Stop local dev environment
dev-stop:
    docker compose down

# View backend logs
logs:
    docker compose logs -f backend

# Rebuild and restart backend
restart:
    docker compose up -d --build backend

# --- Production Deployment (Terraform) ---

# Initialize Terraform
infra-init:
    cd {{infra_dir}} && terraform init

# Plan infrastructure changes
infra-plan:
    cd {{infra_dir}} && terraform plan

# Deploy to production (creates EC2 instance with backend)
deploy:
    #!/usr/bin/env bash
    set -e
    cd {{infra_dir}}

    if [ ! -f terraform.tfvars ]; then
        echo "ERROR: infra/terraform.tfvars not found!"
        echo ""
        echo "Copy and edit the example file:"
        echo "  cp infra/terraform.tfvars.example infra/terraform.tfvars"
        echo ""
        echo "Required variables:"
        echo "  - key_name: Your EC2 key pair name"
        echo "  - postgres_password: Strong database password"
        echo "  - jwt_secret: 64+ char random string (use: openssl rand -hex 32)"
        echo "  - admin_password: Admin user password"
        echo "  - s3_bucket: Your sandbox S3 bucket name"
        exit 1
    fi

    terraform init -upgrade
    terraform apply -auto-approve

    echo ""
    echo "=========================================="
    echo "  Deployment Complete!"
    echo "=========================================="
    terraform output

# Destroy production infrastructure
destroy:
    cd {{infra_dir}} && terraform destroy

# Show deployment outputs (API URL, frontend env vars)
deploy-info:
    cd {{infra_dir}} && terraform output

# SSH into the production server
ssh:
    #!/usr/bin/env bash
    cd {{infra_dir}}
    IP=$(terraform output -raw public_ip 2>/dev/null)
    if [ -z "$IP" ]; then
        echo "No deployment found. Run 'just deploy' first."
        exit 1
    fi
    echo "Connecting to $IP..."
    ssh -i ~/.ssh/$(terraform output -raw key_name 2>/dev/null || echo "your-key").pem ubuntu@$IP

# View production logs
prod-logs:
    #!/usr/bin/env bash
    cd {{infra_dir}}
    IP=$(terraform output -raw public_ip 2>/dev/null)
    if [ -z "$IP" ]; then
        echo "No deployment found. Run 'just deploy' first."
        exit 1
    fi
    ssh ubuntu@$IP "cd /opt/human-archive && docker compose -f docker-compose.prod.yml logs -f"

# Redeploy (pull latest code and rebuild on server)
redeploy:
    #!/usr/bin/env bash
    cd {{infra_dir}}
    IP=$(terraform output -raw public_ip 2>/dev/null)
    if [ -z "$IP" ]; then
        echo "No deployment found. Run 'just deploy' first."
        exit 1
    fi
    echo "Redeploying on $IP..."
    ssh ubuntu@$IP "cd /opt/human-archive && git pull && docker compose -f docker-compose.prod.yml up -d --build"

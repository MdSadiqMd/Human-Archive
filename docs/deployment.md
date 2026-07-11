# Human Archive - Deployment Guide

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         EC2 Instance                            │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐    │
│  │  PostgreSQL │   │   Backend   │   │  Pipeline (manual)  │    │
│  │   :5432     │◄──│   :8080     │   │   (runs on demand)  │    │
│  │  (internal) │   │  (exposed)  │   └─────────────────────┘    │
│  └─────────────┘   └──────┬──────┘              │               │
│                           │                     │               │
│                           │              ┌──────▼──────┐        │
│                           │              │ frames_data │        │
│                           │              │   volume    │        │
│                           │              └─────────────┘        │
└───────────────────────────┼─────────────────────────────────────┘
                            │ :8080
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                           │
│                      (Frontend)                                 │
│                    your-domain.com                              │
└─────────────────────────────────────────────────────────────────┘
```

## S3 Buckets

| Bucket | Purpose | Access |
|--------|---------|--------|
| `demo-hand-tracking-bucket` | Source videos (.mp4) | Read-only |
| Your sandbox bucket | Extracted frames, artifacts | Read/Write |

## Ports to Open (EC2 Security Group)

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP | SSH access |
| 8080 | TCP | 0.0.0.0/0 | Backend API |
| 80 | TCP | 0.0.0.0/0 | HTTP (optional nginx) |
| 443 | TCP | 0.0.0.0/0 | HTTPS (optional nginx) |

**Note**: PostgreSQL (5432) is NOT exposed - internal only.

---

## Quick Deploy with Terraform

### Prerequisites

- [Terraform](https://terraform.io) >= 1.5
- [just](https://github.com/casey/just) command runner
- AWS CLI configured with credentials
- EC2 key pair created in your region

### 1. Configure Variables

```bash
cp infra/terraform.tfvars.example infra/terraform.tfvars
```

Edit `infra/terraform.tfvars`:

```hcl
aws_region        = "ap-south-1"
instance_type     = "t3.medium"
key_name          = "your-ec2-key-pair-name"

postgres_password = "STRONG_DB_PASSWORD_HERE"
jwt_secret        = "USE_OUTPUT_OF_openssl_rand_hex_32"
admin_email       = "admin@yourdomain.com"
admin_password    = "YOUR_ADMIN_PASSWORD"

s3_bucket         = "your-sandbox-bucket"
source_bucket     = "demo-hand-tracking-bucket"
```

Generate secrets:
```bash
# JWT secret (64 chars)
openssl rand -hex 32

# Postgres password
openssl rand -base64 24
```

### 2. Deploy

```bash
just deploy
```

This will:
1. Create EC2 instance with security group
2. Create IAM role with S3 access
3. Install Docker and clone repo
4. Start postgres + backend containers

### 3. Get Frontend Environment Variables

```bash
just deploy-info
```

Output:
```
api_url = "http://13.235.xx.xx:8080"
frontend_env = <<EOT
  # Add to your frontend .env or wrangler.toml
  VITE_API_URL=http://13.235.xx.xx:8080
EOT
```

---

## Frontend Configuration (Cloudflare Workers)

Add to your `wrangler.toml`:

```toml
[vars]
VITE_API_URL = "http://<EC2_PUBLIC_IP>:8080"
```

Or in frontend `.env`:
```env
VITE_API_URL=http://<EC2_PUBLIC_IP>:8080
```

---

## Just Commands Reference

### Local Development

```bash
just dev          # Start local postgres + backend
just dev-stop     # Stop local environment
just logs         # View backend logs
just restart      # Rebuild and restart backend
```

### Production

```bash
just deploy       # Deploy to AWS (creates EC2)
just deploy-info  # Show API URL and frontend env vars
just destroy      # Tear down infrastructure
just ssh          # SSH into production server
just prod-logs    # View production logs
just redeploy     # Pull latest code and rebuild on server
```

### Pipeline

```bash
just build        # Build Go pipeline binary
just run          # Download & classify videos from S3
just ingest       # Ingest classified frames into backend
```

---

## Manual Docker Commands (on server)

```bash
cd /opt/human-archive

# Start services
docker compose -f docker-compose.prod.yml up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f backend

# Restart backend
docker compose -f docker-compose.prod.yml restart backend

# Stop all
docker compose -f docker-compose.prod.yml down

# Rebuild after code changes
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Running the Pipeline

Pipeline processes videos from S3 and extracts frames:

```bash
# On server
cd /opt/human-archive

docker compose -f docker-compose.prod.yml --profile pipeline run --rm pipeline \
  -bucket demo-hand-tracking-bucket \
  -limit 10 \
  -dest-bucket your-sandbox-bucket
```

---

## HTTPS with Nginx + Let's Encrypt

```bash
# Install nginx and certbot
sudo apt install nginx certbot python3-certbot-nginx -y

# Create nginx config
sudo nano /etc/nginx/sites-available/human-archive
```

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable and get SSL
sudo ln -s /etc/nginx/sites-available/human-archive /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com
```

Then update frontend: `VITE_API_URL=https://api.yourdomain.com`

---

## Database Backup

```bash
# Backup
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U ha_user humanarchive > backup_$(date +%Y%m%d).sql

# Restore
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U ha_user humanarchive < backup.sql
```

---

## Troubleshooting

### Backend not starting
```bash
docker compose -f docker-compose.prod.yml logs backend
```
Common issues: missing .env vars, DB not ready, port conflict

### Database connection issues
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec postgres psql -U ha_user -d humanarchive
```

### Frontend can't reach backend
1. Check security group allows port 8080
2. Test: `curl http://<IP>:8080/auth/login`
3. Check CORS (backend allows all origins)
4. Verify `VITE_API_URL` matches EC2 IP

---

## Resource Requirements

| Service | CPU | Memory | Storage |
|---------|-----|--------|---------|
| PostgreSQL | 0.5 vCPU | 512MB | 10GB+ |
| Backend | 0.5 vCPU | 256MB | minimal |
| Pipeline | 2 vCPU | 2GB | 20GB+ temp |

**Recommended**: t3.medium (2 vCPU, 4GB) or t3.large (2 vCPU, 8GB) for pipeline.

# DOCKER-GENIUS — Docker Setup Guide

## Prerequisites (Linux VM)
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
```

## 1. Clone / copy repo to VM
```bash
scp -r ./docker-genius user@vm-ip:~/docker-genius
# or git clone if pushed to repo
```

## 2. Start full stack
```bash
cd docker-genius
docker compose up -d --build
```

Services started:
| Service | URL |
|---|---|
| Frontend (nginx) | http://VM_IP |
| Backend API | http://VM_IP:3000/api |
| Swagger docs | http://VM_IP:3000/api/docs |
| cAdvisor metrics | http://VM_IP:8080 |
| MySQL | VM_IP:3306 |

MySQL is pre-seeded with tenants, 375 products, 375 clients, 885 invoices, and 486 payments.

First-time startup takes ~2–3 minutes (MySQL health check + seed import).

## 3. Verify containers are healthy
```bash
docker compose ps
docker logs erp_app --tail 20
```

## 4. Check cAdvisor is collecting
```bash
curl http://localhost:8080/api/v2.0/stats/erp_app?count=1 | python3 -m json.tool | head -40
```

## 5. Adjust erp_app resource limits (Governor will automate this)
```bash
# Scale up
docker update --cpus 3.0 --memory 3g erp_app

# Scale down
docker update --cpus 1.0 --memory 1g erp_app
```

## 6. Logs
```bash
docker compose logs -f erp-app        # backend logs
docker compose logs -f cadvisor       # cadvisor logs
docker compose logs -f mysql          # mysql logs
```

## 7. Reset / re-seed
```bash
docker compose down -v                # removes mysql_data volume
docker compose up -d --build          # fresh seed on next start
```

## cAdvisor API endpoints used by telemetry collector
```
GET /api/v2.0/stats/{container_name}?count=1    # latest snapshot
GET /api/v2.0/stats/{container_name}?count=N    # last N samples
```

Key metrics fields:
- `cpu.usage.total` — nanoseconds (delta / 1e9 / interval = CPU%)
- `memory.usage` — bytes in use
- `memory.limit` — current memory cap (Governor's lever)

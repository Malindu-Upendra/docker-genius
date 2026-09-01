# DOCKER-GENIUS — Startup Guide

**Project:** MSc Research — Proactive Vertical Elasticity Engine  
**Student:** Y.A. Malindu Upendra | MS25906158 | SLIIT

---

## Prerequisites

- Docker Desktop installed and **running** (check menu bar — whale icon must be solid)
- Python 3.12 (installed via `brew install python@3.12`)

---

## Step 1 — Start the Full Stack

```bash
cd /Users/malinduupendra/Documents/assignments.nosync/Research/docker-genius
docker compose up -d
```

First-time build takes ~3 minutes. Subsequent starts take ~30 seconds.

Verify all containers are running:

```bash
docker compose ps
```

| Container    | Service     | Port           |
|--------------|-------------|----------------|
| erp_app      | NestJS API  | localhost:3000 |
| erp_mysql    | MySQL 8.0   | localhost:3307 |
| erp_frontend | React/Nginx | localhost:80   |
| erp_cadvisor | cAdvisor    | localhost:8080 |

---

## Step 2 — Open the Application

| URL                            | What it is              |
|--------------------------------|-------------------------|
| http://localhost               | ERP Frontend (React UI) |
| http://localhost:3000/api/docs | Swagger API docs        |
| http://localhost:9090          | Governor Dashboard      |
| http://localhost:8080          | cAdvisor metrics        |

**Login credentials:**

| Field    | Value                    |
|----------|--------------------------|
| Email    | `admin@colomboretail.lk` |
| Password | `test123`                |

---

## Step 3 — Activate the Python Environment

All governor, LSTM, and experiment commands run inside the venv.  
Run this once per terminal session before any `python3` command below:

```bash
cd /Users/malinduupendra/Documents/assignments.nosync/Research/docker-genius/governor
source venv/bin/activate
```

> **All Step 4–10 commands assume you are in the `governor/` directory with venv active.**

---

## Step 4 — Start the Metrics Dashboard

```bash
python3 dashboard/server.py --config dashboard/config.yaml
```

Open **http://localhost:9090**. Shows live CPU/RAM of `erp_app`, per-tier (TIER_1/2/3) latency P50/P95/P99, requests/sec, and current resource limits. Best viewed while the load test is running.

---

## Step 5 — Collect LSTM Training Data

The LSTM learns CPU/RAM patterns from the container under realistic load.  
Run the load test and the telemetry collector **at the same time** in two separate terminals.

**Terminal A — load test (simulated workload):**

```bash
cd /Users/malinduupendra/Documents/assignments.nosync/Research/docker-genius/governor
source venv/bin/activate
python3 ../load-tests/mixed_load.py --duration 1200
```

**Terminal B — telemetry collector (captures CPU/RAM):**

```bash
cd /Users/malinduupendra/Documents/assignments.nosync/Research/docker-genius/governor
source venv/bin/activate
python3 lstm/collect_training_data.py --duration 1200 --output lstm/training_data.csv
```

1200 seconds (20 min) is recommended. Minimum is 600 seconds (10 min).  
Both commands should finish at roughly the same time.

---

## Step 6 — Train the LSTM Model

After Step 5 finishes:

```bash
python3 lstm/train.py --data lstm/training_data.csv
```

Expected output:
- Training for up to 50 epochs with early stopping
- Final val MAE printed in % CPU and MB RAM
- Three files saved:

| File | What it is |
|---|---|
| `lstm/model.keras` | Trained LSTM weights |
| `lstm/scaler.pkl` | MinMaxScaler (required for inference) |
| `lstm/train_plot.png` | Loss/MAE curves |

---

## Step 7 — Verify the Predictor

```bash
python3 lstm/predictor.py
```

Should print a forecast showing predicted CPU% and memory MB for the next 30 steps.  
If it prints an error, re-run Step 6.

---

## Step 8 — Run the 3-Group Experiment

> Requires Step 6 to be complete (`lstm/model.keras` must exist).

Clean any leftover test data first:

```bash
rm -f experiment/results/group*_kpi.csv \
      experiment/results/group*_timeseries.csv \
      experiment/results/all_groups_*.csv \
      experiment/results/experiment_summary.txt
```

Run the full experiment:

```bash
python3 experiment/run_experiment.py --duration 300 --cooldown 60
```

Total runtime: ~17 minutes. The three groups run back-to-back:

| Group | Label | What the governor does |
|---|---|---|
| 1 | Static Allocation | Nothing — fixed resources (control) |
| 2 | Reactive-Only | Rule engine reacts to live CPU/RAM (no LSTM) |
| 3 | Proactive Hybrid | LSTM forecasts → rule engine → Docker update |

Between each group: container resets to 2 cpus / 2 GB, request log is cleared, 60s cooldown.

Results saved to `governor/experiment/results/`:

| File | Contents |
|---|---|
| `group1_kpi.csv` / `group2_kpi.csv` / `group3_kpi.csv` | Per-request latency, status, SLA breach flag |
| `group1_governor.csv` / `group2_governor.csv` / `group3_governor.csv` | Scaling decisions with timestamps |
| `experiment_summary.txt` | P50/P95/P99/breach% table |

To re-run a single group only:

```bash
python3 experiment/run_experiment.py --duration 300 --groups 3
```

---

## Step 9 — Statistical Analysis

Run after Step 8. Two scripts in order:

**Step 9a — build time-series CSVs:**

```bash
python3 analysis/kpi_processor.py --results experiment/results
```

**Step 9b — Mann-Whitney U tests + thesis figures:**

```bash
python3 analysis/mann_whitney.py --results experiment/results
```

Outputs in `governor/experiment/results/`:

| File | Contents |
|---|---|
| `all_groups_summary.csv` | Aggregate P50/P95/P99/breach% per group |
| `all_groups_timeseries.csv` | 10-second rolling windows |
| `statistical_report.txt` | U-statistic, z, p-value, effect size per test |
| `figures/latency_boxplot.png` | Side-by-side latency distributions |
| `figures/latency_timeseries.png` | P95 + breach rate over time, all 3 groups |

The report confirms whether Group 3 (Proactive Hybrid) achieves ≥30% SLA breach reduction over Group 1 (Static) at p < 0.05.

---

## Step 10 — Stop Everything

```bash
cd /Users/malinduupendra/Documents/assignments.nosync/Research/docker-genius
docker compose down
```

To also wipe the database (full reset — reloads seed data on next `up`):

```bash
docker compose down -v
```

---

## Reference — Other Useful Commands

**Rebuild after code changes:**
```bash
docker compose up -d --build
```

**Rebuild only the frontend:**
```bash
docker compose up -d --build frontend
```

**View live logs:**
```bash
docker compose logs -f erp-app     # NestJS backend
docker compose logs -f frontend    # Nginx
docker compose logs -f mysql       # MySQL
```

**Run the telemetry terminal monitor:**
```bash
python3 telemetry/live_monitor.py
```

> cAdvisor shows OFFLINE on macOS — expected. Linux cgroups required for cAdvisor.

**Self-test the rule engine:**
```bash
python3 rule_engine/rule_engine.py
```

**Self-test the Docker updater:**
```bash
python3 docker_api/updater.py
```

---

## Troubleshooting

**Docker daemon not running**  
→ Open Docker Desktop and wait for it to fully start.

**erp_app keeps restarting**  
→ MySQL hasn't finished initialising. Wait 60–90 seconds, then `docker compose ps`.

**Login fails with no error message**  
→ Old frontend image. Run `docker compose up -d --build frontend`.

**Data gone after `docker compose down -v`**  
→ Expected — `-v` wipes the volume. It reloads from `init-seed-int.sql` on next `up`.

**cAdvisor always OFFLINE in live_monitor.py**  
→ Expected on macOS. Use the Ubuntu 22.04 research VM for actual experiments.

**Port 80 already in use**  
→ Stop the conflicting service or change the frontend port in `docker-compose.yml`.

**LSTM train.py — "only N rows, need at least X"**  
→ Not enough training data collected. Re-run Step 5 for longer (at least 600 seconds).

**experiment/run_experiment.py — "Model not found"**  
→ Step 6 (train.py) has not been run yet, or ran from the wrong directory.

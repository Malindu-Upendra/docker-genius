# DOCKER-GENIUS

A proactive vertical elasticity engine for business-critical monolithic Docker containers. This is the implementation and experiment harness accompanying the paper *"DOCKER-GENIUS: A Proactive Vertical Elasticity Engine for Business-Critical Monolithic Applications"* (Y.A. Malindu Upendra, SLIIT).

DOCKER-GENIUS combines LSTM-based CPU/RAM forecasting, semantic request-tier classification (`TIER_1`/`TIER_3`), and a four-rule governance engine to proactively resize a monitored Docker container's CPU/memory limits in place, via the native Docker Update API, without restarting it.

## Repository layout

```
governor/            # The Monolith Governor: rule engine, LSTM training/inference,
                      # Docker API client, and the full experiment harness
  rule_engine/        # 4-rule governance logic
  lstm/               # LSTM training, baseline model comparison, saved model artifacts
  docker_api/         # Docker Update API client
  telemetry/          # cAdvisor/docker-stats telemetry collection
  experiment/         # 3-group experiment runner, ablation study runner,
                       # scalability test runner, and their result CSVs/logs
  analysis/           # Mann-Whitney U + bootstrap CI statistical analysis
load-tests/           # Synthetic multi-tenant load generator (mixed_load.py)
nexcore-backend/      # The monitored NestJS ERP application (POS, inventory, reporting)
nexcore-frontend/     # React frontend for the ERP application
docker-compose.yml    # Full stack: MySQL, ERP backend, frontend, cAdvisor
docker-compose.tenant2.yml  # Second independent tenant stack, used for the
                            # N=2 scalability check
figures/              # Paper figures (architecture, workflow, LSTM model,
                       # experimental setup, latency, prediction, resource utilization)
NEXT_STEPS.md         # Running research log: every experiment run, bug found,
                       # and finding, in chronological order
```

## Reproducing an experiment

1. `docker compose up -d` — brings up MySQL, the ERP backend/frontend, and cAdvisor.
2. Train the LSTM (if `governor/lstm/model.keras` doesn't already exist):
   ```
   cd governor && python3 lstm/collect_training_data.py && python3 lstm/train.py
   ```
3. Run the 3-group experiment (static / reactive-only / proactive hybrid):
   ```
   python3 experiment/run_experiment.py --repeats 5
   ```
4. Run the statistical analysis:
   ```
   python3 analysis/mann_whitney.py
   ```

See `governor/experiment/run_ablation.py` for the ablation study and `governor/experiment/run_scalability_test.py` for the two-tenant scalability check (the latter requires `docker-compose.tenant2.yml`'s services to also be running).

## Honest status

This is real, replicated experimental work, including negative and mixed results reported as found — not a cherry-picked demonstration. The paper is explicit that:
- The proactive hybrid's advantage over simpler baselines only appears at a more aggressively-tuned rule-engine configuration than originally specified, and is modest (7–8% SLA breach-rate reduction) relative to the original ≥30% target.
- A five-replicate ablation study could not cleanly attribute this improvement to the LSTM component specifically.
- A classical ARIMA model matched or exceeded the LSTM's own forecast accuracy on the dataset used here.

`NEXT_STEPS.md` has the full, dated history of every run, bug, and finding.

## License

Academic research code, provided as-is for reproducibility purposes.

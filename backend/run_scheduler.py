"""
Точка входа для фонового сервиса синхронизации.
Запускать отдельно от web (uvicorn main:app).
Использование: python run_scheduler.py
"""
import logging
import sys

from scheduler import sync_dislocation_to_tracking, start_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def main():
    logger.info("scheduler process: starting")
    start_scheduler()
    logger.info("scheduler process: running (sync every 10 min). Ctrl+C to stop.")
    try:
        import time
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("scheduler process: stopped")


if __name__ == "__main__":
    main()

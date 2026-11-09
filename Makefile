# Credence — contributor convenience targets.
#
# The authoritative, cross-platform gate runner is scripts/verify_all.py (it mirrors
# .github/workflows/ci.yml and runs on Windows too). These targets are thin wrappers so
# `make verify` works on POSIX; on Windows run the Python script directly:
#   python scripts\verify_all.py
#
# Override the interpreters/tools the runner uses via env, e.g.:
#   make verify CREDENCE_PYTHON=/path/to/.venv/Scripts/python.exe

PYTHON ?= python

.PHONY: verify verify-contracts verify-pytest verify-adapter verify-sdk list-gates help

help:
	@echo "Credence make targets:"
	@echo "  make verify            - run all local gates (lint+typecheck+pytest+adapter+sdk)"
	@echo "  make verify-contracts  - genvm-lint check + typecheck on all four contracts"
	@echo "  make verify-pytest     - pytest tests/direct"
	@echo "  make verify-adapter       - node --test in adapter/"
	@echo "  make verify-sdk        - tsc --noEmit in sdk/"
	@echo "  make list-gates        - print each gate and its resolved command"

verify:
	$(PYTHON) scripts/verify_all.py

verify-contracts:
	$(PYTHON) scripts/verify_all.py contracts

verify-pytest:
	$(PYTHON) scripts/verify_all.py pytest

verify-adapter:
	$(PYTHON) scripts/verify_all.py adapter

verify-sdk:
	$(PYTHON) scripts/verify_all.py sdk

list-gates:
	$(PYTHON) scripts/verify_all.py --list

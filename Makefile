SHELL := /bin/bash -o pipefail

.PHONY: install lint test format license

install:             ## install repo tooling (license check, pre-commit) + git hooks
	uv sync --group dev
	@# Git hooks — NOT `pre-commit install`: it refuses whenever core.hooksPath
	@# is set at any scope (e.g. machines with global ccc reindex hooks).
	@bash tools/install-hooks.sh || echo "make install: git hooks NOT installed (pre-commit missing?) — run 'uv tool install pre-commit' then 'bash tools/install-hooks.sh'" >&2

lint:                ## run ruff on tools/
	uv run ruff check tools

format:              ## auto-format tools/ with ruff
	uv run ruff format tools && uv run ruff check --fix tools

license:             ## verify Python dev dependency licenses
	uv run tools/license_check.py

test:                ## run Worker + frontend test suites
	cd worker && npm test
	cd frontend && npm test
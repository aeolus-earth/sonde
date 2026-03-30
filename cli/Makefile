.DEFAULT_GOAL := help

.PHONY: help install test lint format typecheck check setup

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (dev included)
	uv sync

test: ## Run tests
	uv run pytest

lint: ## Run linter
	uv run ruff check src/ tests/

format: ## Auto-format code
	uv run ruff format src/ tests/

typecheck: ## Run type checker
	uv run ty check src/

check: lint typecheck test ## Lint + type-check + test

setup: install ## Install deps, then run sonde setup
	uv run sonde setup

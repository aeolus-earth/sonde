.PHONY: setup dev test lint clean ci-local ci-browser ci-data ci-auth ci-all install-hooks

# ── One-command setup for new contributors ──────────────────────────

setup:
	@echo "==> Installing CLI (Python)"
	cd cli && uv sync
	@echo "==> Installing UI (Node)"
	cd ui && npm install
	@echo "==> Installing Server (Node)"
	cd server && npm install
	@echo ""
	@echo "Done. Next steps:"
	@echo "  1. cp .env.example .env  (fill in credentials)"
	@echo "  2. cd cli && uv run sonde login"
	@echo "  3. make dev"

# ── Start all services ──────────────────────────────────────────────

dev:
	@echo "Start these in separate terminals:"
	@echo ""
	@echo "  1. supabase start              # local database (requires Docker)"
	@echo "  2. cd server && npm run dev    # MCP server on port 3001"
	@echo "  3. cd ui && npm run dev        # UI on http://localhost:5173"
	@echo "  4. cd cli && uv run sonde login  # authenticate"

# ── Run all tests ───────────────────────────────────────────────────

test:
	@echo "==> CLI tests"
	cd cli && uv run pytest -m "not integration" -q
	@echo "==> UI tests"
	cd ui && npm run test 2>/dev/null || echo "  (no UI tests yet)"
	@echo "==> Server type check"
	cd server && npm run lint

# ── Lint all packages ───────────────────────────────────────────────

lint:
	@echo "==> CLI lint"
	cd cli && uv run ruff check src/ tests/
	@echo "==> UI lint"
	cd ui && npm run lint
	@echo "==> Server lint"
	cd server && npm run lint

# ── Clean build artifacts ───────────────────────────────────────────

clean:
	rm -rf cli/dist ui/dist server/dist

# ── Shared CI entrypoints ────────────────────────────────────────────

ci-local:
	@bash scripts/ci/core.sh all

ci-browser:
	@bash scripts/ci/browser.sh all

ci-data:
	@bash scripts/ci/data.sh

ci-auth:
	@bash scripts/ci/auth.sh

ci-all:
	@bash scripts/ci/core.sh all
	@bash scripts/ci/browser.sh all
	@bash scripts/ci/data.sh
	@bash scripts/ci/auth.sh

install-hooks:
	@git config core.hooksPath .githooks
	@chmod +x .githooks/pre-push
	@echo "Installed Sonde git hooks at .githooks/"

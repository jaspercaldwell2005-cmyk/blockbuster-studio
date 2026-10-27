SHELL := /bin/bash
.DEFAULT_GOAL := help

NPM ?= npm

# --- Full studio container (own GPU, e.g. RTX 5090) ---
IMAGE ?= docker.io/kiloloco/blockbuster-studio:latest
CONTAINER ?= blockbuster-studio
WORKSPACE ?= $(HOME)/blockbuster-studio
STUDIO_PORT ?= 3000
SHM_SIZE ?= 16g
GPU ?= all
# Extra docker flags, e.g. DOCKER_ENV="-e DOWNLOAD_UPSCALE_MODELS=true"
DOCKER_ENV ?=
# 1 = serve the web build from this checkout (dist/web) instead of the one baked into the image.
# `make container-dev-static` sets this for you; pair it with `make dev-web-watch`.
WEB_MOUNT ?= 0
WEB_MOUNT_FLAG = $(if $(filter 1,$(WEB_MOUNT)),-v "$(CURDIR)/dist/web:/opt/studio/dist/web:ro")
# 1 = let the container reach a service on the host at host.docker.internal (e.g. an LLM on port 8888).
HOST_GATEWAY ?= 1
HOST_GATEWAY_FLAG = $(if $(filter 1,$(HOST_GATEWAY)),--add-host=host.docker.internal:host-gateway)
# WSL2 only: `make llm-relay` forwards a Windows-loopback LLM into Docker on this port.
LLM_RELAY_PORT ?= 8889
LLM_TARGET_PORT ?= 8888
LLM_TARGET_HOST ?= 127.0.0.1
# Everything between `docker run` and the image name except -p (the port is resolved at run time);
# DOCKER_ENV passes extra -e flags.
CONTAINER_FLAGS = -v "$(WORKSPACE):/workspace" $(WEB_MOUNT_FLAG) $(HOST_GATEWAY_FLAG) $(DOCKER_ENV)

.PHONY: help \
	container-check container-pull container-up container-dev container-dev-static container-start container-stop \
	container-restart container-logs container-shell container-status container-update container-remove open \
	db-clear media-clear reset-data \
	install dev dev-mock dev-tts dev-server dev-web dev-web-watch dev-web-container llm-relay \
	build build-web build-server start test typecheck check validate-workflows clean

help: ## Show this help
	@echo "Blockbuster Studio — local development"
	@awk 'BEGIN {FS = ":.*## "} \
		/^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} \
		/^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo "Overrides: NPM=... · IMAGE=... · WORKSPACE=... · STUDIO_PORT=... · DOCKER_ENV=\"-e KEY=value\" · HOST_GATEWAY=0 disables host.docker.internal · LLM_RELAY_PORT=8889 forwards a Windows-loopback LLM · YES=1 skips confirmations"
	@echo "Env vars pass through for dev: MOCK_DELAY_MS=0 make dev"

##@ Full studio in Docker (own GPU, e.g. RTX 5090)

container-check: container-pull ## Check the host GPU and Docker GPU access (needs CUDA 12.8+)
	@echo "Host GPU:"
	@nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader \
		|| { echo "nvidia-smi not found: install the NVIDIA driver first."; exit 1; }
	@echo "GPU inside a container:"
	docker run --rm --gpus $(GPU) --entrypoint nvidia-smi $(IMAGE) \
		--query-gpu=name,memory.total --format=csv,noheader

container-pull: ## Pull the studio image
	docker pull $(IMAGE)

container-up: ## Create or recreate the studio container (keeps /workspace data; pulls the image if missing)
	@mkdir -p "$(WORKSPACE)"
	@if [ "$(WEB_MOUNT)" = "1" ] && [ ! -f "$(CURDIR)/dist/web/index.html" ]; then \
		echo "dist/web/index.html is missing. Run 'make build-web' (or 'make dev-web-watch') first."; exit 1; fi
	@busy() { \
		if command -v ss >/dev/null 2>&1; then ss -ltnH 2>/dev/null | awk '{print $$4}' | grep -qE "[:.]$$1$$"; \
		elif command -v lsof >/dev/null 2>&1; then lsof -iTCP:"$$1" -sTCP:LISTEN >/dev/null 2>&1; \
		else (exec 3<>/dev/tcp/127.0.0.1/"$$1") 2>/dev/null; fi; \
	}; \
	port='$(STUDIO_PORT)'; \
	if [ "$(origin STUDIO_PORT)" = "file" ]; then \
		existing="$$(docker inspect -f '{{with (index .HostConfig.PortBindings "3000/tcp")}}{{(index . 0).HostPort}}{{end}}' $(CONTAINER) 2>/dev/null)"; \
		if [ -n "$$existing" ]; then \
			port="$$existing"; \
		else \
			while busy "$$port"; do port=$$((port + 1)); done; \
			[ "$$port" = "$(STUDIO_PORT)" ] || echo "Host port $(STUDIO_PORT) is taken; using $$port instead (http://localhost:$$port)."; \
		fi; \
	fi; \
	if busy "$$port" && [ "$$(docker port $(CONTAINER) 3000/tcp 2>/dev/null | grep -c ":$$port$$")" = "0" ]; then \
		echo "Port $$port is already in use (another dev server, or another studio)."; \
		echo "Nothing was changed. Run the same command with a free port, e.g. STUDIO_PORT=$$((port + 1))."; \
		exit 1; \
	fi; \
	old=$$(docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null || echo missing); \
	if [ "$$old" = "true" ]; then docker stop $(CONTAINER) >/dev/null && echo "Stopped the previous container."; fi; \
	docker rm -f $(CONTAINER)-next >/dev/null 2>&1 || true; \
	if docker run -d --name $(CONTAINER)-next --gpus $(GPU) --shm-size=$(SHM_SIZE) \
		-p "$$port:3000" \
		$(CONTAINER_FLAGS) \
		$(IMAGE) >/dev/null; then \
		docker rm -f $(CONTAINER) >/dev/null 2>&1 || true; \
		docker rename $(CONTAINER)-next $(CONTAINER); \
	else \
		echo; \
		echo "Could not start the studio on host port $$port."; \
		echo "Nothing was deleted: the previous container is unchanged."; \
		docker rm -f $(CONTAINER)-next >/dev/null 2>&1 || true; \
		if [ "$$old" = "true" ]; then docker start $(CONTAINER) >/dev/null && echo "Started the previous container again."; fi; \
		exit 1; \
	fi; \
	echo "Studio: http://localhost:$$port (create your password within 15 minutes)"; \
	if [ "$(WEB_MOUNT)" = "1" ]; then \
		echo "Frontend: serving $(CURDIR)/dist/web from the host."; \
		echo "Run 'make dev-web-watch' in another terminal: each save rebuilds dist/web, then refresh the browser."; \
	else \
		echo "Models (~128 GB) download in the background; follow them with: make container-logs"; \
	fi

container-dev: ## Start the studio container and Vite hot reload in one terminal
	@image='$(IMAGE)'; \
	if [ "$(origin IMAGE)" = "file" ]; then \
		image="$$(docker inspect -f '{{.Config.Image}}' $(CONTAINER) 2>/dev/null || echo '$(IMAGE)')"; \
	fi; \
	$(MAKE) --no-print-directory container-up WEB_MOUNT=0 IMAGE="$$image"
	@echo "Frontend: hot reload on http://localhost:5174 (saving web/src updates the page)"
	@$(MAKE) --no-print-directory dev-web-container

container-dev-static: ## Recreate the container with this checkout's dist/web mounted (pair with make dev-web-watch)
	@$(MAKE) --no-print-directory container-up WEB_MOUNT=1


container-start: ## Resume a stopped container (no model re-download)
	docker start $(CONTAINER)

container-stop: ## Stop the container (keeps your models and films)
	docker stop $(CONTAINER)

container-restart: ## Restart the container (reopens the 15-minute setup window if unclaimed)
	docker restart $(CONTAINER)

container-logs: ## Follow the container log
	docker logs -f --tail=200 $(CONTAINER)

container-shell: ## Open a shell inside the container
	docker exec -it $(CONTAINER) bash

container-status: ## Show whether the container is running and its ports
	@docker ps -a --filter name=^/$(CONTAINER)$$ --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# Uses the port the container was created with, so it works without passing STUDIO_PORT.
# Best effort across desktops; on a headless host it just prints the URL.
open: ## Open the studio in your browser (the running container's port)
	@port="$$(docker inspect -f '{{with (index .HostConfig.PortBindings "3000/tcp")}}{{(index . 0).HostPort}}{{end}}' $(CONTAINER) 2>/dev/null)"; \
	[ -n "$$port" ] || port='$(STUDIO_PORT)'; \
	url="http://localhost:$$port"; \
	if [ "$$(docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null)" != "true" ]; then \
		echo "The studio container isn't running. Start it with 'make container-start', then run 'make open'."; \
		echo "URL once it's up: $$url"; \
		exit 1; \
	fi; \
	echo "Opening $$url"; \
	if command -v xdg-open >/dev/null 2>&1; then xdg-open "$$url" >/dev/null 2>&1 || true; \
	elif command -v open >/dev/null 2>&1; then open "$$url" || true; \
	elif command -v wslview >/dev/null 2>&1; then wslview "$$url" || true; \
	elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$$url" >/dev/null 2>&1 || true; \
	else echo "No browser opener found; open $$url yourself."; fi

container-update: container-pull ## Pull the latest image and recreate the container
	@$(MAKE) --no-print-directory container-up
	@echo "Updated. This container now runs the image you just pulled."

container-remove: ## Delete the container (keeps the WORKSPACE folder on disk)
	docker rm -f $(CONTAINER)

##@ Studio data (destructive; they ask first, or pass YES=1)

db-clear: ## Delete the studio database (backs it up; keeps password, models and media)
	@if [ "$(YES)" != "1" ]; then printf "%s [y/N] " "Delete the studio database? Projects, cast, jobs and saved settings are lost."; read answer; case "$$answer" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 1;; esac; fi
	@running=$$(docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null || echo missing); \
	img=$$(docker inspect -f '{{.Config.Image}}' $(CONTAINER) 2>/dev/null || echo $(IMAGE)); \
	stamp=$$(date +%Y%m%d-%H%M%S); \
	if [ "$$running" = "true" ]; then docker stop $(CONTAINER) >/dev/null; fi; \
	docker run --rm -v "$(WORKSPACE):/workspace" --entrypoint sh "$$img" -c "set -e; \
		mkdir -p /workspace/studio/db-backups; \
		if [ -f /workspace/studio/studio.db ]; then \
			cp /workspace/studio/studio.db /workspace/studio/db-backups/studio-$$stamp.db; \
			if [ -f /workspace/studio/studio.db-wal ]; then cp /workspace/studio/studio.db-wal /workspace/studio/db-backups/studio-$$stamp.db-wal; fi; \
		fi; \
		rm -f /workspace/studio/studio.db /workspace/studio/studio.db-wal /workspace/studio/studio.db-shm"; \
	echo "Database backup: $(WORKSPACE)/studio/db-backups/studio-$$stamp.db"; \
	if [ "$$running" = "true" ]; then docker start $(CONTAINER) >/dev/null && echo "Database cleared; the studio restarted with a fresh one."; else echo "Database cleared."; fi

media-clear: ## Delete every generated image, clip and film (keeps the database)
	@if [ "$(YES)" != "1" ]; then printf "%s [y/N] " "Delete every generated image, clip and film? This cannot be undone."; read answer; case "$$answer" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 1;; esac; fi
	@running=$$(docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null || echo missing); \
	img=$$(docker inspect -f '{{.Config.Image}}' $(CONTAINER) 2>/dev/null || echo $(IMAGE)); \
	if [ "$$running" = "true" ]; then \
		docker exec $(CONTAINER) sh -c 'find /workspace/studio/media -mindepth 1 -delete'; \
	else \
		docker run --rm -v "$(WORKSPACE):/workspace" --entrypoint sh "$$img" -c 'find /workspace/studio/media -mindepth 1 -delete'; \
	fi; \
	echo "Media folder cleared: $(WORKSPACE)/studio/media"

reset-data: ## Clear the database AND every generated file (asks once; backs up the database)
	@if [ "$(YES)" != "1" ]; then printf "%s [y/N] " "Clear the database and every generated image, clip and film? The database is backed up first."; read answer; case "$$answer" in y|Y|yes|YES) ;; *) echo "Cancelled."; exit 1;; esac; fi
	@$(MAKE) --no-print-directory db-clear YES=1
	@$(MAKE) --no-print-directory media-clear YES=1
	@echo "Studio data reset. The password, models and logs were kept."

##@ Local development (no GPU)

install: ## Install dependencies
	$(NPM) install

dev: ## Run everything: mock ComfyUI, mock TTS, API server, web app
	$(NPM) run dev

dev-mock: ## Run only the fake ComfyUI (port 8188)
	$(NPM) run dev:mock

dev-tts: ## Run only the fake voice sidecar (port 8190)
	$(NPM) run dev:tts

dev-server: ## Run only the API server with reload (port 3000)
	$(NPM) run dev:server

dev-web: ## Run only the Vite web app (port 5173)
	$(NPM) run dev:web

dev-web-watch: ## Rebuild dist/web on every save, for `make container-dev-static`
	$(NPM) run build:web:watch

# Real hot-module reload against a running container: Vite on 5174, /api proxied to the container's port.
# `make container-dev` runs this for you after starting the container.
dev-web-container: ## Vite with HMR (port 5174) proxying /api to the running studio container
	@if [ "$$(docker inspect -f '{{.State.Running}}' $(CONTAINER) 2>/dev/null)" != "true" ]; then \
		echo "The studio container isn't running. Start it with 'make container-start' or 'make container-dev'."; exit 1; \
	fi; \
	port="$$(docker inspect -f '{{with (index .HostConfig.PortBindings "3000/tcp")}}{{(index . 0).HostPort}}{{end}}' $(CONTAINER) 2>/dev/null)"; \
	[ -n "$$port" ] || port='$(STUDIO_PORT)'; \
	echo "HMR: http://localhost:5174  (API proxied to http://localhost:$$port)"; \
	VITE_PROXY_TARGET=http://127.0.0.1:$$port $(NPM) run dev:web -- --port 5174 --strictPort

# WSL2 mirrored networking: a Windows app on 127.0.0.1 isn't reachable from Docker, and WSL can't
# rebind the same port. This proxy listens on LLM_RELAY_PORT and forwards to LLM_TARGET_PORT.
llm-relay: ## WSL2: expose an LLM on Windows loopback to the container (use LLM_RELAY_PORT in Settings)
	@echo "LLM relay: use port $(LLM_RELAY_PORT) in Settings → AI provider (Ctrl-C stops it)."
	@LLM_RELAY_PORT=$(LLM_RELAY_PORT) LLM_TARGET_PORT=$(LLM_TARGET_PORT) LLM_TARGET_HOST=$(LLM_TARGET_HOST) \
		node scripts/llm-relay.mjs

build: ## Build the web app and the server bundle
	$(NPM) run build

build-web: ## Build the web app into dist/web
	$(NPM) run build:web

build-server: ## Bundle the server into dist/server.js
	$(NPM) run build:server

start: ## Run the built server from dist (requires make build)
	$(NPM) start

test: ## Run the test suite once
	$(NPM) test

typecheck: ## Type-check with tsc
	$(NPM) run typecheck

check: typecheck test ## Type-check and run the tests

validate-workflows: ## Validate workflows against a REAL ComfyUI (needs COMFY_URL)
	$(NPM) run validate:workflows

clean: ## Remove build output (dist)
	rm -rf dist

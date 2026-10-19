.PHONY: build test clean deploy

# Deploy settings (override on the command line, e.g.
#   make deploy SOURCE=deployer ADMINS='["GABC..."]'
# For multi-admin: ADMINS='["G1...","G2...","G3..."]' THRESHOLD=2 TIMELOCK_DELAY=86400
NETWORK ?= testnet
THRESHOLD ?= 1
TIMELOCK_DELAY ?= 0
WASM_DIR = target/wasm32v1-none/release

build:
	cd ../.. && cargo build --manifest-path contracts/donation/Cargo.toml --target wasm32-unknown-unknown --release

test:
	cd ../.. && cargo test --manifest-path contracts/donation/Cargo.toml --lib

clean:
	cd ../.. && cargo clean --manifest-path contracts/donation/Cargo.toml

fmt:
	cd ../.. && cargo fmt --manifest-path contracts/donation/Cargo.toml

lint:
	cd ../.. && cargo clippy --manifest-path contracts/donation/Cargo.toml --target wasm32-unknown-unknown

# Deploys the donation + creator-registry pair. Both are initialized by their
# constructors in the deploy transaction (no separate initialize call). The
# registry ID is derived from SALT first so the donation contract can be
# constructed with it; set SALT to reuse a recorded salt.
deploy:
	@test -n "$(SOURCE)" || { echo "SOURCE (deployer key alias) is required"; exit 1; }
	@test -n '$(ADMINS)' || { echo "ADMINS (JSON array of admin addresses) is required"; exit 1; }
	cd ../.. && cargo build --manifest-path contracts/donation/Cargo.toml --target wasm32v1-none --release
	cd ../.. && cargo build --manifest-path contracts/creator-registry/Cargo.toml --target wasm32v1-none --release
	@cd ../.. && set -e; \
	SALT="$${SALT:-$$(openssl rand -hex 32)}"; \
	echo "salt: $$SALT"; \
	REGISTRY_ID=$$(stellar contract id wasm --salt "$$SALT" --source-account $(SOURCE) --network $(NETWORK)); \
	DONATION_ID=$$(stellar contract deploy --wasm $(WASM_DIR)/donation.wasm \
	  --source-account $(SOURCE) --network $(NETWORK) -- \
	  --admins '$(ADMINS)' --threshold $(THRESHOLD) --timelock_delay $(TIMELOCK_DELAY) \
	  --registry "$$REGISTRY_ID"); \
	DEPLOYED_REGISTRY_ID=$$(stellar contract deploy --wasm $(WASM_DIR)/creator_registry.wasm \
	  --salt "$$SALT" --source-account $(SOURCE) --network $(NETWORK) -- \
	  --admins '$(ADMINS)' --threshold $(THRESHOLD) --timelock_delay $(TIMELOCK_DELAY) \
	  --donation_contract "$$DONATION_ID"); \
	test "$$DEPLOYED_REGISTRY_ID" = "$$REGISTRY_ID" || { echo "registry ID mismatch: expected $$REGISTRY_ID, got $$DEPLOYED_REGISTRY_ID"; exit 1; }; \
	echo "DONATION_CONTRACT_ID=$$DONATION_ID"; \
	echo "REGISTRY_CONTRACT_ID=$$REGISTRY_ID"

.PHONY: all build build-contracts deploy-testnet setup-tokens check-tokens format clean

all: build

build: build-contracts

build-contracts:
	cargo build --manifest-path contracts/creator-registry/Cargo.toml --target wasm32v1-none --release
	cargo build --manifest-path contracts/donation/Cargo.toml --target wasm32v1-none --release

deploy-testnet:
	bash scripts/deploy-testnet.sh

setup-tokens:
	bash scripts/testnet-setup-tokens.sh

check-tokens:
	node scripts/check-token-allowlist.mjs

format:
	cargo fmt --all
	npm run format || true

clean:
	cargo clean

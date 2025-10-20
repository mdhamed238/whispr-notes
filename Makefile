# Makefile for building with eas-cli
# Usage:
#   make preview-ios
#   make dev-android
#   make build MODE=preview PLATFORM=ios
#   make build (defaults: MODE=development PLATFORM=all)

.DEFAULT_GOAL := help

EAS := eas
MODE ?= preview
PLATFORM ?= android

.PHONY: help preview development ios android preview-ios preview-android dev-ios dev-android build all

help:
	@echo "Usage: make <target> [MODE=development|preview] [PLATFORM=ios|android|all]"
	@echo ""
	@echo "Targets:"
	@echo "  preview            => shorthand to set MODE=preview"
	@echo "  development        => shorthand to set MODE=development"
	@echo "  ios                => shorthand to set PLATFORM=ios"
	@echo "  android            => shorthand to set PLATFORM=android"
	@echo "  preview-ios        => build preview for iOS"
	@echo "  preview-android    => build preview for Android"
	@echo "  dev-ios            => build development for iOS"
	@echo "  dev-android        => build development for Android"
	@echo "  build              => run eas build with MODE=$(MODE) PLATFORM=$(PLATFORM)"
	@echo ""

preview:
	$(MAKE) build MODE=preview

development:
	$(MAKE) build MODE=development

ios:
	$(MAKE) build PLATFORM=ios

android:
	$(MAKE) build PLATFORM=android

preview-ios:
	$(MAKE) build MODE=preview PLATFORM=ios

preview-android:
	$(MAKE) build MODE=preview PLATFORM=android

dev-ios:
	$(MAKE) build MODE=development PLATFORM=ios

dev-android:
	$(MAKE) build MODE=development PLATFORM=android

all:
	$(MAKE) build PLATFORM=all MODE=$(MODE)

build:
	@command -v $(EAS) >/dev/null 2>&1 || { echo "eas CLI not found. Install @expo/eas-cli and try again."; exit 1; }
	@if [ "$(PLATFORM)" = "all" ]; then \
		echo "Building for ios (profile=$(MODE))..."; \
		$(EAS) build --profile $(MODE) --platform ios || exit 1; \
		echo "Building for android (profile=$(MODE))..."; \
		$(EAS) build --profile $(MODE) --platform android || exit 1; \
	else \
		echo "Building for $(PLATFORM) (profile=$(MODE))..."; \
		$(EAS) build --profile $(MODE) --platform $(PLATFORM); \
	fi
#!/usr/bin/env bash
# Build a release zip that extracts to a folder called "Dean Tools"
# Usage: npm run release

set -euo pipefail

VERSION=$(node -p "require('./manifest.json').version")
RELEASE_DIR="release"
FOLDER_NAME="Dean Tools"
ZIP_NAME="dean-tools-v${VERSION}.zip"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/$FOLDER_NAME"
cp -r dist/chrome/* "$RELEASE_DIR/$FOLDER_NAME/"

cd "$RELEASE_DIR"
zip -r "../$ZIP_NAME" "$FOLDER_NAME"
cd ..
rm -rf "$RELEASE_DIR"

echo ""
echo "  Created: $ZIP_NAME"
echo "  Extracts to: $FOLDER_NAME/"
echo ""

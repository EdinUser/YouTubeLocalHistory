#!/bin/bash

# YouTube Local History Extension Test Runner
# Usage: ./run-tests.sh [test-type]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
fi

# Function to run tests
run_tests() {
    local test_type=$1

    case $test_type in
        "unit")
            print_status "Running unit tests..."
            npm run test:unit
            ;;
        "integration")
            print_status "Running integration tests..."
            npm run test:integration
            ;;
        "memory")
            print_status "Running memory leak tests..."
            npm run test:memory
            ;;
        "coverage")
            print_status "Running tests with coverage..."
            npm run test:coverage
            ;;
        "watch")
            print_status "Running tests in watch mode..."
            npm run test:watch
            ;;
        "e2e")
            print_status "Running end-to-end tests..."
            npm run test:e2e
            ;;
        "all"|"")
            print_status "Running all tests..."
            npm test
            ;;
        *)
            print_error "Unknown test type: $test_type"
            echo "Available options: unit, integration, memory, coverage, watch, e2e, all"
            exit 1
            ;;
    esac
}

# Main execution
print_status "YouTube Local History Extension Test Runner"
echo "=================================================="

# Check if Jest is available
if ! command -v npx &> /dev/null; then
    print_error "npx is not available. Please install Node.js and npm."
    exit 1
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the project root."
    exit 1
fi

# Run tests based on argument
if [ $# -eq 0 ]; then
    print_status "No test type specified, running all tests..."
    run_tests "all"
else
    run_tests "$1"
fi

print_success "Test execution completed!"
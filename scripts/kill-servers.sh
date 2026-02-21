#!/bin/bash

# Kill processes on ports 3000 and 3001
echo "Killing processes on ports 3000 and 3001..."

# Kill React (port 3000)
lsof -ti:3000 | xargs kill -9 2>/dev/null || echo "No process on port 3000"

# Kill Express (port 3001)
lsof -ti:3001 | xargs kill -9 2>/dev/null || echo "No process on port 3001"

# Kill any suspended jobs (from Ctrl+Z)
jobs -p | xargs kill -9 2>/dev/null || echo "No suspended jobs"

echo "Done!"

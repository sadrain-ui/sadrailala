#!/bin/bash

echo "🚀 Installing Master Dashboard..."
echo ""

# Check if Node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo "✅ npm found: $(npm --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Installation complete!"
    echo ""
    echo "🚀 Start development server:"
    echo "   npm run dev"
    echo ""
    echo "📱 Open browser:"
    echo "   http://localhost:4000"
    echo ""
    echo "🔐 Login:"
    echo "   Email: admin@legion.com"
    echo "   Password: password"
else
    echo "❌ Installation failed"
    exit 1
fi

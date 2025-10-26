#!/bin/bash

# Zwift Hub Controller - Git Setup Script
# This script helps you set up git and push to GitHub

echo "🚴 Zwift Hub Controller - Git Setup"
echo "===================================="
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git is not installed. Please install git first:"
    echo "   https://git-scm.com/downloads"
    exit 1
fi

echo "✅ Git is installed"
echo ""

# Check if already a git repository
if [ -d .git ]; then
    echo "⚠️  This is already a git repository."
    echo "   Current remote:"
    git remote -v
    echo ""
    read -p "Do you want to continue anyway? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
else
    echo "📁 Initializing git repository..."
    git init
    echo "✅ Repository initialized"
    echo ""
fi

# Get GitHub username and repository name
echo "Please provide your GitHub details:"
echo ""
read -p "GitHub username: " github_user
read -p "Repository name (e.g., zwift-hub-controller): " repo_name

echo ""
echo "Your repository will be: https://github.com/$github_user/$repo_name"
read -p "Is this correct? (Y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Set up remote
echo ""
echo "🔗 Setting up git remote..."
if git remote get-url origin &> /dev/null; then
    echo "   Updating existing origin..."
    git remote set-url origin "https://github.com/$github_user/$repo_name.git"
else
    echo "   Adding new origin..."
    git remote add origin "https://github.com/$github_user/$repo_name.git"
fi
echo "✅ Remote configured"

# Update README with actual URLs
echo ""
echo "📝 Updating README.md with your repository info..."
sed -i.bak "s/YOUR_USERNAME/$github_user/g" README.md
sed -i.bak "s/YOUR_REPO_NAME/$repo_name/g" README.md
rm README.md.bak 2>/dev/null
echo "✅ README updated"

# Add all files
echo ""
echo "📦 Adding files to git..."
git add .
echo "✅ Files staged"

# Create initial commit
echo ""
echo "💾 Creating initial commit..."
git commit -m "Initial commit: Zwift Hub Controller with FTMS protocol"
echo "✅ Commit created"

# Set main branch
echo ""
echo "🌿 Setting main branch..."
git branch -M main
echo "✅ Branch set to main"

# Ready to push
echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Create repository on GitHub: https://github.com/new"
echo "      - Name: $repo_name"
echo "      - Visibility: Public (for free GitHub Pages)"
echo "      - Don't initialize with README"
echo ""
echo "   2. Push to GitHub:"
echo "      git push -u origin main"
echo ""
echo "   3. Enable GitHub Pages:"
echo "      - Go to repository Settings → Pages"
echo "      - Source: GitHub Actions"
echo ""
echo "   4. Your site will be live at:"
echo "      https://$github_user.github.io/$repo_name/"
echo ""
echo "Happy training! 🚴💨"

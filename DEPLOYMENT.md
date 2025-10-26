# Deployment Guide

## Quick Start: Deploy to GitHub Pages

This repository includes a GitHub Actions workflow that automatically deploys your app to GitHub Pages on every push to the main branch.

### Prerequisites
- A GitHub account
- Git installed on your computer

### Step-by-Step Instructions

#### 1. Create GitHub Repository

Go to [github.com/new](https://github.com/new) and create a new repository:
- Name: `zwift-hub-controller` (or your preferred name)
- Visibility: Public (required for free GitHub Pages)
- Don't initialize with README (we already have one)

#### 2. Initialize Git and Push

Open terminal in your project folder (`/Users/wolfv/Programs/zwift/`) and run:

```bash
# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Zwift Hub Controller with FTMS protocol"

# Set main branch
git branch -M main

# Add your GitHub repository as remote (replace YOUR_USERNAME and YOUR_REPO)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Push to GitHub
git push -u origin main
```

#### 3. Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top right)
3. Click **Pages** in the left sidebar
4. Under "Build and deployment":
   - **Source**: Select "GitHub Actions"
5. Click **Save**

#### 4. Wait for Deployment

1. Go to the **Actions** tab in your repository
2. You should see a workflow run called "Deploy to GitHub Pages"
3. Wait for it to complete (usually 1-2 minutes)
4. Once complete, your site will be live!

#### 5. Access Your Site

Your app will be available at:
```
https://YOUR_USERNAME.github.io/YOUR_REPO/
```

For example: `https://wolfv.github.io/zwift-hub-controller/`

#### 6. Update README

Edit `README.md` and replace the placeholder URLs:
- Change `YOUR_USERNAME/YOUR_REPO_NAME` to your actual GitHub username and repo name
- Update the live demo link at the top

```bash
# After editing README.md
git add README.md
git commit -m "Update README with actual GitHub Pages URL"
git push
```

### Workflow Details

The workflow (`.github/workflows/deploy.yml`) automatically:
- ✅ Triggers on every push to main branch
- ✅ Can be manually triggered from Actions tab
- ✅ Uploads all files to GitHub Pages
- ✅ Deploys with proper HTTPS support (required for Web Bluetooth)

### Updating Your Site

Any time you make changes:
```bash
git add .
git commit -m "Your commit message"
git push
```

The site will automatically redeploy in 1-2 minutes!

## Alternative: Deploy to Other Platforms

### Netlify
1. Go to [netlify.com](https://netlify.com)
2. Drag and drop your project folder
3. Site is live instantly with HTTPS!

### Vercel
1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Deploy with zero configuration

### Cloudflare Pages
1. Go to [pages.cloudflare.com](https://pages.cloudflare.com)
2. Connect your GitHub repository
3. Deploy with automatic HTTPS

All of these platforms provide:
- ✅ Free hosting
- ✅ HTTPS (required for Web Bluetooth)
- ✅ Automatic deployments on git push
- ✅ Custom domains

## Troubleshooting

### Web Bluetooth doesn't work
- Make sure your site is served over **HTTPS** (not HTTP)
- GitHub Pages automatically provides HTTPS
- Test in Chrome, Edge, or Opera (Firefox doesn't support Web Bluetooth)

### Workflow fails
- Check that GitHub Pages is enabled in repository settings
- Make sure source is set to "GitHub Actions"
- Check the Actions tab for error details

### Site shows 404
- Wait a few minutes after first deployment
- Check that `index.html` is in the root directory
- Verify the URL format: `https://USERNAME.github.io/REPO/`

## Need Help?

- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Web Bluetooth API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- Check the Actions tab for deployment logs

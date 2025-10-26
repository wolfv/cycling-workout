# 🚀 Publishing Your Zwift Hub Controller

## What's Been Set Up

Your Zwift Hub Controller is ready to be published as a live website! Here's what's included:

### ✅ GitHub Actions Workflow
- **File**: `.github/workflows/deploy.yml`
- **Purpose**: Automatically deploys your site to GitHub Pages on every push
- **Triggers**: Pushes to main branch, or manual trigger
- **Requirements**: GitHub Pages enabled in repository settings

### ✅ Configuration Files
- **`.gitignore`**: Excludes logs, Bluetooth captures, and OS files
- **`setup-git.sh`**: Interactive script to help with initial setup
- **`DEPLOYMENT.md`**: Detailed deployment instructions

### ✅ Updated Documentation
- **`README.md`**: Includes deployment instructions and live demo link placeholders

## Quick Start (3 Steps)

### Option A: Use the Setup Script (Easiest)

```bash
cd /Users/wolfv/Programs/zwift
./setup-git.sh
```

Follow the prompts, then:
1. Create repository on GitHub
2. Run: `git push -u origin main`
3. Enable GitHub Pages in repository settings

### Option B: Manual Setup

```bash
cd /Users/wolfv/Programs/zwift

# Initialize and commit
git init
git add .
git commit -m "Initial commit: Zwift Hub Controller"
git branch -M main

# Add your GitHub repository (create it first on github.com/new)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Then enable GitHub Pages: Settings → Pages → Source: GitHub Actions

## What Happens After Push

1. **GitHub Actions runs** automatically
2. **All files are uploaded** to GitHub Pages
3. **HTTPS is enabled** (required for Web Bluetooth)
4. **Site goes live** in 1-2 minutes

Your URL will be: `https://YOUR_USERNAME.github.io/YOUR_REPO/`

## Important Notes

### ✅ Works Out of the Box
- No build step required
- No dependencies to install
- Pure HTML/CSS/JavaScript
- Just push and it works!

### 🔒 HTTPS is Automatic
- GitHub Pages provides HTTPS by default
- Required for Web Bluetooth API
- No certificate configuration needed

### 📱 Responsive Design
- Works on desktop, tablet, and mobile
- Bluetooth pairing works on mobile Chrome/Edge
- Optimized for all screen sizes

### 🌍 No Backend Needed
- Everything runs in the browser
- No server costs
- Completely free hosting
- Workout data stored in browser localStorage

## Updating Your Site

After making changes:

```bash
git add .
git commit -m "Description of changes"
git push
```

The site automatically redeploys in 1-2 minutes!

## Sharing Your Workouts

Since workouts are stored in localStorage:
- Use the **Export** button to save as JSON
- Share JSON files with friends
- Others can **Import** them into their app
- Perfect for sharing training plans!

## Custom Domain (Optional)

Want to use your own domain?

1. Go to repository Settings → Pages
2. Add custom domain (e.g., `zwift.yourdomain.com`)
3. Configure DNS with your domain provider
4. GitHub handles HTTPS certificate automatically

See: [GitHub Pages Custom Domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)

## Alternative Hosting Platforms

Your app works on any static hosting platform:

### Netlify (easiest)
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
cd /Users/wolfv/Programs/zwift
netlify deploy --prod
```

### Vercel
1. Import from GitHub at vercel.com
2. Zero configuration needed
3. Automatic deployments on push

### Cloudflare Pages
1. Connect GitHub repository
2. Build command: (none)
3. Output directory: /

## Troubleshooting

### "Web Bluetooth is not available"
- ✅ Make sure you're using HTTPS (GitHub Pages does this automatically)
- ✅ Use Chrome, Edge, or Opera (not Firefox or Safari)
- ✅ Check browser console for errors

### "Actions workflow not running"
- ✅ Check that GitHub Pages is enabled: Settings → Pages
- ✅ Source must be set to "GitHub Actions"
- ✅ Check Actions tab for error messages

### "Site shows 404"
- ✅ Wait 2-3 minutes after first deploy
- ✅ Check URL format: `username.github.io/repo/` (with trailing slash)
- ✅ Verify `index.html` is in root directory

## Files You Can Safely Remove

Before publishing, you can optionally remove:
- `zwift_hub_*.html` (old test files)
- `zwfit-log1.btsnoop` and `.pklg` (Bluetooth captures)
- `FTMS_FINDINGS.md` (unless you want to keep for reference)

Keep:
- `index.html` (main app)
- All `.js` and `.css` files
- `README.md`, `DEPLOYMENT.md`
- `.github/` folder

## Need Help?

- 📖 [Detailed deployment guide](DEPLOYMENT.md)
- 🐛 [GitHub Pages docs](https://docs.github.com/en/pages)
- 💬 Open an issue on GitHub if you run into problems

## Ready to Go! 🎉

Your app is production-ready:
- ✅ Professional design
- ✅ Full FTMS protocol support
- ✅ Workout designer with FTP zones
- ✅ Real-time metrics (Power, HR, Cadence)
- ✅ Workout library with visual previews
- ✅ Responsive layout
- ✅ Dark theme
- ✅ No dependencies
- ✅ Free hosting ready

Just push to GitHub and start sharing! 🚴💨

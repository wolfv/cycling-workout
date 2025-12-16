// Auto-generated version file
// Run: ./update-version.sh to regenerate

window.APP_VERSION = {
    gitHash: '5c607e1',
    gitHashFull: '5c607e146128c01a58b3a69a737ea55f84edf729',
    timestamp: '2025-12-16T20:00:40.000Z',
    cacheBuster: '5c607e1'
};

// Update version display if element exists
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('gitHash')) {
        document.getElementById('gitHash').textContent = 'v' + window.APP_VERSION.gitHash;
    }
});

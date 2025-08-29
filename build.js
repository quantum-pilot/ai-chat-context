const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Ensure dist directories exist
const dirs = ['dist', 'dist/content-scripts', 'dist/components', 'dist/utils', 'dist/styles', 'dist/icons'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Build content scripts (bundled)
async function buildContentScripts() {
  try {
    // Build Claude content script
    await esbuild.build({
      entryPoints: ['src/content-scripts/claude.ts'],
      bundle: true,
      outfile: 'dist/content-scripts/claude.js',
      platform: 'browser',
      target: 'chrome90',
      format: 'iife',
      minify: false,
      sourcemap: false,
    });

    // Build ChatGPT content script
    await esbuild.build({
      entryPoints: ['src/content-scripts/chatgpt.ts'],
      bundle: true,
      outfile: 'dist/content-scripts/chatgpt.js',
      platform: 'browser',
      target: 'chrome90',
      format: 'iife',
      minify: false,
      sourcemap: false,
    });

    console.log('✅ Content scripts bundled successfully');
  } catch (error) {
    console.error('❌ Error building content scripts:', error);
    process.exit(1);
  }
}

// Copy static files
function copyStaticFiles() {
  // Copy manifest.json
  fs.copyFileSync('manifest.json', 'dist/manifest.json');

  // Copy CSS files
  const cssDir = 'src/styles';
  if (fs.existsSync(cssDir)) {
    const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
    cssFiles.forEach(file => {
      fs.copyFileSync(path.join(cssDir, file), path.join('dist/styles', file));
    });
  }

  // Copy icons
  const iconsDir = 'icons';
  if (fs.existsSync(iconsDir)) {
    const iconFiles = fs.readdirSync(iconsDir).filter(f => f.endsWith('.png'));
    iconFiles.forEach(file => {
      fs.copyFileSync(path.join(iconsDir, file), path.join('dist/icons', file));
    });
  }

  console.log('✅ Static files copied');
}

// Main build function
async function build() {
  console.log('🔨 Building extension...');

  // Clean dist directory
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }

  // Recreate directories
  dirs.forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
  });

  // Build and copy
  await buildContentScripts();
  copyStaticFiles();

  console.log('✅ Build complete!');
}

// Run build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
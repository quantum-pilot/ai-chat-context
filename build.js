const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Build content scripts (bundled)
async function buildContentScripts() {
  try {
    // Ensure content-scripts directory exists
    if (!fs.existsSync('dist/content-scripts')) {
      fs.mkdirSync('dist/content-scripts', { recursive: true });
    }

    // Build Claude content script
    await esbuild.build({
      entryPoints: ['src/content-scripts/claude.ts'],
      bundle: true,
      outfile: 'dist/content-scripts/claude.js',
      platform: 'browser',
      target: 'chrome90',
      format: 'iife',
      minify: true,
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
      minify: true,
      sourcemap: false,
    });

    console.log('✅ Content scripts bundled successfully');
  } catch (error) {
    console.error('❌ Error building content scripts:', error);
    process.exit(1);
  }
}

// Build background scripts for both Chrome and Firefox
async function buildBackgroundScripts() {
  try {
    // Ensure background directory exists
    if (!fs.existsSync('dist/background')) {
      fs.mkdirSync('dist/background', { recursive: true });
    }

    // Build Chrome service worker (from shared source)
    await esbuild.build({
      entryPoints: ['src/background/sw.ts'],
      bundle: true,
      outfile: 'dist/background/sw.js',
      platform: 'browser',
      target: 'chrome90',
      format: 'iife',
      minify: true,
      sourcemap: false,
      loader: {
        '.json': 'json',
      },
    });

    // Build Firefox event page (from same shared source)
    await esbuild.build({
      entryPoints: ['src/background/sw.ts'],
      bundle: true,
      outfile: 'dist/background/event-page.js',
      platform: 'browser',
      target: 'firefox109',
      format: 'iife',
      minify: true,
      sourcemap: false,
      loader: {
        '.json': 'json',
      },
    });

    console.log('✅ Background scripts bundled successfully');
  } catch (error) {
    console.error('❌ Error building background scripts:', error);
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
    if (cssFiles.length > 0) {
      // Only create styles directory if we have CSS files to copy
      if (!fs.existsSync('dist/styles')) {
        fs.mkdirSync('dist/styles', { recursive: true });
      }
      cssFiles.forEach(file => {
        fs.copyFileSync(path.join(cssDir, file), path.join('dist/styles', file));
      });
    }
  }

  // Copy icons
  const iconsDir = 'icons';
  if (fs.existsSync(iconsDir)) {
    const iconFiles = fs.readdirSync(iconsDir).filter(f => f.endsWith('.png'));
    if (iconFiles.length > 0) {
      // Only create icons directory if we have icon files to copy
      if (!fs.existsSync('dist/icons')) {
        fs.mkdirSync('dist/icons', { recursive: true });
      }
      iconFiles.forEach(file => {
        fs.copyFileSync(path.join(iconsDir, file), path.join('dist/icons', file));
      });
    }
  }

  // Create directories for WASM and encodings
  if (!fs.existsSync('dist/wasm')) {
    fs.mkdirSync('dist/wasm', { recursive: true });
  }
  if (!fs.existsSync('dist/encodings')) {
    fs.mkdirSync('dist/encodings', { recursive: true });
  }

  // Copy WASM file
  fs.copyFileSync(
    'node_modules/tiktoken/lite/tiktoken_bg.wasm',
    'dist/wasm/tiktoken_bg.wasm'
  );

  // Copy encoding files
  fs.copyFileSync(
    'node_modules/tiktoken/encoders/o200k_base.json',
    'dist/encodings/o200k_base.json'
  );
  fs.copyFileSync(
    'node_modules/@anthropic-ai/tokenizer/dist/cjs/claude.json',
    'dist/encodings/claude.json'
  );

  console.log('✅ Static files, WASM, and encodings copied');
}

// Main build function
async function build() {
  console.log('🔨 Building extension...');

  // Clean dist directory
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true, force: true });
  }

  // Create base dist directory
  fs.mkdirSync('dist', { recursive: true });

  // Build and copy
  await buildContentScripts();
  await buildBackgroundScripts();
  copyStaticFiles();

  console.log('✅ Build complete!');
}

// Run build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});

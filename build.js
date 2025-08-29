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
      external: ['*.wasm', '*.json'],
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
      external: ['*.wasm', '*.json'],
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

  // Copy WASM file from tiktoken
  const wasmSource = 'node_modules/tiktoken/lite/tiktoken_bg.wasm';
  if (fs.existsSync(wasmSource)) {
    // Only create wasm directory when copying the WASM file
    if (!fs.existsSync('dist/wasm')) {
      fs.mkdirSync('dist/wasm', { recursive: true });
    }
    fs.copyFileSync(wasmSource, 'dist/wasm/tiktoken_bg.wasm');
    console.log('✅ WASM file copied');
  } else {
    console.error('⚠️ WASM file not found at:', wasmSource);
  }

  // Copy o200k_base encoding JSON file
  const encodingSource = 'node_modules/tiktoken/encoders/o200k_base.json';
  if (fs.existsSync(encodingSource)) {
    // Only create encodings directory when copying the encoding file
    if (!fs.existsSync('dist/encodings')) {
      fs.mkdirSync('dist/encodings', { recursive: true });
    }
    fs.copyFileSync(encodingSource, 'dist/encodings/o200k_base.json');
    console.log('✅ Encoding file copied');
  } else {
    console.error('⚠️ Encoding file not found at:', encodingSource);
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

  // Create base dist directory
  fs.mkdirSync('dist', { recursive: true });

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

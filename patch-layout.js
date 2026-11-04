const fs = require('fs');

// Patch __root.tsx
let root = fs.readFileSync('src/routes/__root.tsx', 'utf8');
// Base substrate should be bg-background (the deepest layer)
root = root.replace(/body className="(.*?)bg-surface-1(.*?)"/, 'body className="$1bg-background$2"');
root = root.replace(/div className="relative flex w-full h-svh bg-surface-1 overflow-hidden"/, 'div className="relative flex w-full h-svh bg-background overflow-hidden"');
// Main canvas should be bg-surface-1 (elevated)
root = root.replace(/main className="(.*?)bg-background(.*?)shadow-surface-3(.*?)"/, 'main className="$1bg-surface-1$2shadow-surface-3$3"');
fs.writeFileSync('src/routes/__root.tsx', root);

// Patch app-sidebar.tsx
let left = fs.readFileSync('src/components/layout/app-sidebar.tsx', 'utf8');
left = left.replace(/bg-surface-1/, 'bg-background');
fs.writeFileSync('src/components/layout/app-sidebar.tsx', left);

// Patch studio-sidebar.tsx
let right = fs.readFileSync('src/components/layout/studio-sidebar.tsx', 'utf8');
right = right.replace(/bg-surface-1/, 'bg-background');
fs.writeFileSync('src/components/layout/studio-sidebar.tsx', right);


const fs = require('fs');
let code = fs.readFileSync('src/components/ui/button.tsx', 'utf8');

// Remove the span wrapper around children
code = code.replace(
  /<span className=\{cn\(!isIconOnly && "\[text-box:trim-both_cap_alphabetic\]"\)\}>\s*\{children\}\s*<\/span>/g,
  '{children}'
);

// We should also remove it from the loading state if we want, or leave it.
// Let's add text-box trim to the buttonVariants directly instead.
code = code.replace(
  '"group relative inline-flex items-center justify-center',
  '"group relative inline-flex items-center justify-center [text-box:trim-both_cap_alphabetic]'
);

fs.writeFileSync('src/components/ui/button.tsx', code);

const config = {
  '**/*.{js,cjs}': (filenames) => [
    `oxfmt --write ${filenames.join(' ')}`,
    `oxlint ${filenames.join(' ')}`,
  ],
  '**/*.ts': (filenames) => [
    `oxfmt --write ${filenames.join(' ')}`,
    `oxlint ${filenames.join(' ')}`,
    'tsc --noEmit',
  ],
  '**/*.json': (filenames) => [`oxfmt --write ${filenames.join(' ')}`],
  '**/*.md': (filenames) => [`oxfmt --write ${filenames.join(' ')}`],
}

export default config

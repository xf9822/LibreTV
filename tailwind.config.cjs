// Builds css/tailwind.css: `npm run build:css` after adding Tailwind classes to HTML or JS.
// Class names must appear whole in the source (no `bg-${color}`), so the scan can find them.
module.exports = {
    content: ['./*.html', './js/**/*.js'],
    theme: { extend: {} },
    plugins: []
};

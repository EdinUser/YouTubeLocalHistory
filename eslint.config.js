module.exports = [
    {
        ignores: [
            'build/**',
            'coverage/**',
            'node_modules/**'
        ]
    },
    {
        files: ['src/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'script',
            globals: {
                afterAll: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                browser: 'readonly',
                chrome: 'readonly',
                clearInterval: 'readonly',
                clearTimeout: 'readonly',
                console: 'readonly',
                document: 'readonly',
                DOMParser: 'readonly',
                expect: 'readonly',
                global: 'readonly',
                jest: 'readonly',
                localStorage: 'readonly',
                module: 'readonly',
                MutationObserver: 'readonly',
                navigator: 'readonly',
                performance: 'readonly',
                process: 'readonly',
                require: 'readonly',
                setInterval: 'readonly',
                setTimeout: 'readonly',
                URL: 'readonly',
                window: 'readonly'
            }
        },
        rules: {}
    }
];

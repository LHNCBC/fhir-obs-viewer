// From https://github.com/cypress-io/cypress/issues/19066#issuecomment-1001308186
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsConfigFile = path.resolve(__dirname, './tsconfig.json');

export default {
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.json']
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        use: {
          loader: 'ts-loader',
          options: {
            configFile: tsConfigFile
          }
        }
      },
      {
        // Angular linker needed to link partial-ivy code
        // See https://angular.io/guide/creating-libraries#consuming-partial-ivy-code-outside-the-angular-cli
        test: /[/\\]@angular[/\\].+\.m?js$/,
        resolve: {
          fullySpecified: false
        },
        use: {
          loader: 'babel-loader',
          options: {
            plugins: ['@angular/compiler-cli/linker/babel'],
            compact: false,
            cacheDirectory: true
          }
        }
      }
    ]
  }
};

const path = require('path');
const iosPlatform = require('@react-native-community/cli-platform-ios');
const pak = require('../package.json');

module.exports = {
  dependencies: {
    [pak.name]: {
      root: path.join(__dirname, '..'),
    },
  },
  commands: iosPlatform.commands,
  project: {
    ios: {
      sourceDir: 'ios',
      automaticPodsInstallation: false,
    }
  },
  platforms: {
    ios: {
      projectConfig: iosPlatform.projectConfig,
      dependencyConfig: iosPlatform.dependencyConfig,
    },
  },
};

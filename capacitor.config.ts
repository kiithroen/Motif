import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.motif.sketchbook',
  appName: 'Motif',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#0c111a',
    allowMixedContent: false,
  },
};

export default config;

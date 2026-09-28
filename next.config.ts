import type { NextConfig } from 'next';
// devIndicators: the route badge covered panel text in the corner; compile and runtime errors still show.
const config: NextConfig = { poweredByHeader: false, agentRules: false, logging: false, devIndicators: false };
export default config;

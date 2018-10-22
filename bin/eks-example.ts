#!/usr/bin/env node
import { EksClusterStack } from '../lib/eks-cluster';
import { EksNodeGroupStack } from '../lib/eks-node-group';
import cdk = require('@aws-cdk/cdk');

const app = new cdk.App();

const clusterName = 'EksExample'
const cluster = new EksClusterStack(app, 'EksCluster', { clusterName });

new EksNodeGroupStack(app, 'EksWorkers', {
  controlPlaneSG: cluster.controlPlaneSG,
  vpc: cluster.vpc,
  clusterName,

});

app.run();

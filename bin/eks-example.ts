#!/usr/bin/env node
import { EksClusterStack } from '../lib/eks-cluster';
import { EksNodeGroupStack } from '../lib/eks-node-group';
import cdk = require('@aws-cdk/cdk');

const app = new cdk.App();

const clusterName = app.getContext('cluster-name');
const cluster = new EksClusterStack(app, 'EksCluster', { clusterName });

// worker node configuration properties
const bastion: boolean = !!app.getContext('bastion');
const nodeGroupMaxSize = app.getContext('node-group-max-size');
const nodeGroupMinSize = app.getContext('node-group-max-size');
const nodeGroupDesiredSize = app.getContext('node-group-max-size');
const keyFromContext = app.getContext('key-name');
const keyName = (keyFromContext === null) ? undefined : keyFromContext;
const sshAllowedCidr = app.getContext('ssh-allowed-cidr');
const nodeGroupInstanceType = app.getContext('node-group-instance-type');

new EksNodeGroupStack(app, 'EksWorkers', {
  controlPlaneSG: cluster.controlPlaneSG,
  vpc: cluster.vpc,
  clusterName,
  bastion,
  keyName,
  sshAllowedCidr,
  nodeGroupMaxSize,
  nodeGroupMinSize,
  nodeGroupDesiredSize,
  nodeGroupInstanceType,
});

app.run();

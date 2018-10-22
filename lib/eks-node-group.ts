import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');
import asg = require('@aws-cdk/aws-autoscaling');
import cdk = require('@aws-cdk/cdk');

export interface NodeGroupProps extends cdk.StackProps {
  controlPlaneSG: ec2.SecurityGroupRefProps;
  vpc: ec2.VpcNetworkRefProps;
  clusterName: string;
}

const CP_WORKER_PORTS = new ec2.TcpPortRange(1025, 65535);
const API_PORTS = new ec2.TcpPort(443);
const WORKER_NODE_POLICIES: string[] = [
  "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
  "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
  "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
];

export class EksNodeGroupStack extends cdk.Stack {

  public readonly workerNodeASG: asg.AutoScalingGroup;

  constructor(parent: cdk.App, name: string, props: NodeGroupProps) {
    super(parent, name, props);

    const vpc = ec2.VpcNetworkRef.import(this, 'ClusterVpc', props.vpc);
    const controlPlaneSG = ec2.SecurityGroupRef.import(this, 'ControlPlaneSG', props.controlPlaneSG)

    const amiMap: {[region: string]: string;} = {
      'us-west-2': 'ami-0a54c984b9f908c81',
      'us-east-1': 'ami-0440e4f6b9713faf6',
      'eu-west-1': 'ami-0c7a4976cb6fafd3a',
    };
    new asg.AutoScalingGroup(this, 'Bastion', {
      instanceType: new ec2.InstanceTypePair(ec2.InstanceClass.T3, ec2.InstanceSize.Micro),
      machineImage: new ec2.GenericLinuxImage(amiMap),
      vpc,
      minSize: 1,
      maxSize: 1,
      desiredCapacity: 1,
      keyName: 'mcowgill-id-rsa',
      vpcPlacement: {subnetsToUse: ec2.SubnetType.Public},
    });

    this.workerNodeASG = new asg.AutoScalingGroup(this, 'Workers', {
      instanceType: new ec2.InstanceTypePair(ec2.InstanceClass.T3, ec2.InstanceSize.Medium),
      machineImage: new ec2.GenericLinuxImage(amiMap),
      vpc,
      allowAllOutbound: true,
      minSize: 1,
      maxSize: 5,
      desiredCapacity: 3,
      keyName: 'mcowgill-id-rsa',
      vpcPlacement: {subnetsToUse: ec2.SubnetType.Private},
      updateType: asg.UpdateType.RollingUpdate,
      rollingUpdateConfiguration: {
        maxBatchSize: 3,
        minInstancesInService: 0,
        pauseTimeSec: 300,
        waitOnResourceSignals: true,
      },
    });
    this.workerNodeASG.tags.setTag(`kubernetes.io/cluster/${props.clusterName}`, 'owned');
    this.workerNodeASG.tags.setTag('NodeType', 'Worker');
    for (const policy of WORKER_NODE_POLICIES) {
      this.workerNodeASG.role.attachManagedPolicy(policy);
    }

    this.workerNodeASG.role.
      addToPolicy( new iam.PolicyStatement().
                  addAction('cloudformation:SignalResource').
                  addResource( `arn:aws:cloudformation:${new cdk.AwsRegion()}:${new cdk.AwsAccountId()}:stack/${new cdk.AwsStackName}/*`));

    this.workerNodeASG.role.
      addToPolicy( new iam.PolicyStatement().
                  addAction('ec2:DescribeTags').addAllResources());

    const asgResource = this.workerNodeASG.children.find(c => (c as cdk.Resource).resourceType === 'AWS::AutoScaling::AutoScalingGroup') as asg.cloudformation.AutoScalingGroupResource;
    this.workerNodeASG.addUserData(
      'set -o xtrace',
      `/etc/eks/bootstrap.sh ${props.clusterName}`,
      `/opt/aws/bin/cfn-signal --exit-code $? \\`,
      `  --stack ${new cdk.AwsStackName()} \\`,
      `  --resource ${asgResource.logicalId} \\`,
      `  --region ${new cdk.AwsRegion()}`
    );

    this.workerNodeASG.connections.allowFrom(controlPlaneSG, CP_WORKER_PORTS);
    this.workerNodeASG.connections.allowFrom(controlPlaneSG, API_PORTS);
    this.workerNodeASG.connections.allowInternally(new ec2.AllConnections());
    const cpConnection = controlPlaneSG.connections;
    cpConnection.allowTo(this.workerNodeASG, CP_WORKER_PORTS);
    cpConnection.allowTo(this.workerNodeASG, API_PORTS);
    cpConnection.allowFrom(this.workerNodeASG, CP_WORKER_PORTS);
  }
}

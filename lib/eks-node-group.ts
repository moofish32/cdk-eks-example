import ec2 = require('@aws-cdk/aws-ec2');
import iam = require('@aws-cdk/aws-iam');
import asg = require('@aws-cdk/aws-autoscaling');
import cdk = require('@aws-cdk/cdk');

export interface NodeGroupProps extends cdk.StackProps {
  controlPlaneSG: ec2.SecurityGroupRefProps;
  vpc: ec2.VpcNetworkRefProps;
  clusterName: string;
  bastion: boolean;
  sshAllowedCidr: string[];
  keyName?: string;
  nodeGroupMaxSize: number;
  nodeGroupMinSize: number;
  nodeGroupDesiredSize: number;
  nodeGroupInstanceType: string;
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
  private bastionASG: asg.AutoScalingGroup;

  constructor(parent: cdk.App, name: string, props: NodeGroupProps) {
    super(parent, name, props);

    const vpc = ec2.VpcNetworkRef.import(this, 'ClusterVpc', props.vpc);
    const controlPlaneSG = ec2.SecurityGroupRef.import(this, 'ControlPlaneSG', props.controlPlaneSG)

    // have to periodically update this constant
    const amiMap: {[region: string]: string;} = {
      'us-west-2': 'ami-0f54a2f7d2e9c88b3',
      'us-east-1': 'ami-0a0b913ef3249b655',
      'us-east-2': 'ami-0958a76db2d150238',
      'eu-west-1': 'ami-00c3b2d35bddd4f5c',
    };
    this.workerNodeASG = new asg.AutoScalingGroup(this, 'Workers', {
      instanceType: new ec2.InstanceType(props.nodeGroupInstanceType),
      machineImage: new ec2.GenericLinuxImage(amiMap),
      vpc,
      allowAllOutbound: true,
      minSize: props.nodeGroupMinSize,
      maxSize: props.nodeGroupMaxSize,
      desiredCapacity: props.nodeGroupDesiredSize,
      keyName: props.keyName,
      vpcPlacement: {subnetsToUse: ec2.SubnetType.Private},
      updateType: asg.UpdateType.RollingUpdate,
      rollingUpdateConfiguration: {
        maxBatchSize: 1,
        minInstancesInService: 1,
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

    // this issue is being tracked: https://github.com/awslabs/aws-cdk/issues/623
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
    this.workerNodeASG.connections.allowInternally(new ec2.AllTraffic());
    const cpConnection = controlPlaneSG.connections;
    cpConnection.allowTo(this.workerNodeASG, CP_WORKER_PORTS);
    cpConnection.allowTo(this.workerNodeASG, API_PORTS);
    cpConnection.allowFrom(this.workerNodeASG, CP_WORKER_PORTS);

    new cdk.Output(this, 'WorkerRoleArn', {
      value: this.workerNodeASG.role.roleArn,
    });

    // add variable constructs at the end because if they are in the middle they
    // will force a destruction of any resources added after them
    // see: https://awslabs.github.io/aws-cdk/logical-ids.html
    if (props.bastion) {
      this.bastionASG = new asg.AutoScalingGroup(this, 'Bastion', {
        instanceType: new ec2.InstanceTypePair(ec2.InstanceClass.T3, ec2.InstanceSize.Micro),
        machineImage: new ec2.GenericLinuxImage(amiMap),
        vpc,
        minSize: 1,
        maxSize: 1,
        desiredCapacity: 1,
        keyName: props.keyName,
        vpcPlacement: {subnetsToUse: ec2.SubnetType.Public},
      });
      for (const cidr of props.sshAllowedCidr) {
        this.bastionASG.connections.allowFrom(new ec2.CidrIPv4(cidr), new ec2.TcpPort(22));
      }
      this.workerNodeASG.connections.allowFrom(this.bastionASG, new ec2.TcpPort(22));
    }
  }
}

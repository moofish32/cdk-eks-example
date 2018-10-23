import ec2 = require('@aws-cdk/aws-ec2');
import eks = require('@aws-cdk/aws-eks');
import iam = require('@aws-cdk/aws-iam');
import cdk = require('@aws-cdk/cdk');

export interface ClusterProps extends cdk.StackProps {
  clusterName: string;
  vpcProps?: ec2.VpcNetworkProps;
}

const EKS_POLICIES: string[] = [
  "arn:aws:iam::aws:policy/AmazonEKSServicePolicy",
  "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy",
];

export class EksClusterStack extends cdk.Stack {
  public readonly vpc: ec2.VpcNetworkRefProps;
  public readonly controlPlaneSG: ec2.SecurityGroupRefProps;
  public readonly cluster: eks.cloudformation.ClusterResource;
  constructor(parent: cdk.App, name: string, props: ClusterProps) {
    super(parent, name, props);
    const vpc = this.createVpc(props);
    this.vpc = vpc.export();
    const controlPlaneSG = new ec2.SecurityGroup(this, `${props.clusterName}ControlPlaneSG`, {
      vpc,
    });
    this.controlPlaneSG = controlPlaneSG.export();
    const eksRole = new iam.Role(this, 'EksServiceRole', {
      assumedBy: new iam.ServicePrincipal('eks.amazonaws.com'),
      managedPolicyArns: EKS_POLICIES,
    });
    eksRole.addToPolicy(
      new iam.PolicyStatement().
        addAction("elasticloadbalancing:*").
        addAction("ec2:CreateSecurityGroup").
        addAction("ec2:Describe*").
        addAllResources()
    );

    const publicSubnetIds = vpc.publicSubnets.map( s => s.subnetId);
    const privateSubnetIds = vpc.privateSubnets.map( s => s.subnetId);
    this.cluster = new eks.cloudformation.ClusterResource(this, props.clusterName, {
      clusterName: props.clusterName,
      resourcesVpcConfig: {
        subnetIds: publicSubnetIds.concat(privateSubnetIds),
        securityGroupIds: [controlPlaneSG.securityGroupId],
      },
      roleArn: eksRole.roleArn,
    });
  }

  private createVpc(props: ClusterProps): ec2.VpcNetworkRef {
    const vpcProps = props.vpcProps || this.defaultVpcProps(props.clusterName);

    return new ec2.VpcNetwork(this, 'EksVpc', vpcProps);
  }

  private defaultVpcProps(clusterName: string): ec2.VpcNetworkProps {
    const tags: {[key: string]: string} = {};
    tags[`kubernetes.io/cluster/${clusterName}`] = 'shared';
    const privateSubnetTags: {[key: string]: string} = {};
    privateSubnetTags['kubernetes.io/role/internal-elb'] = '1';

    return {
      cidr: '10.0.0.0/16',
      natGateways: 1,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.Public,
          name: 'EksPublic',
          cidrMask: 25,
        },
        {
          subnetType: ec2.SubnetType.Private,
          name: 'EksPrivate',
          cidrMask: 22,
          tags: privateSubnetTags,
        },
      ],
      tags,
    };
  }
}

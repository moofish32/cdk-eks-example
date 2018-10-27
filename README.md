# CDK Example of EKS

First, this is an *example*. This is not production ready. The point of this
repository is demonstrate some of the features available with CDK. The use of
EKS is to ensure there is a enough complexity to make this valuable. This
example makes many assumptions in order to keep to the solution easy to follow.
For example, the rolling update configuration is not exposed and nor does this
address worker node draining during upgrades. 

**If you choose to run this stack you are responsible for any AWS costs that
are incurred. The default values are designed to be cost conscious.**

## Building a Getting Started EKS Cluster

This repository has reasonable quick start defaults for two AWS CloudFormation
stacks that result in a working EKS cluster. In order to use `kubectl` with this
you will still need to ensure you have the [prerequisites AWS
requires](https://docs.aws.amazon.com/eks/latest/userguide/configure-kubectl.html).
I have chosen to use the `cdk.json` file to pass in and configure parameters.
There are multiple options for [passing parameters into CDK](https://awslabs.github.io/aws-cdk/passing-in-data.html).
We will cover the supported options in each stack.

#### CDK Setup

If you don't already have the CDK installed please follow the
[guide](https://awslabs.github.io/aws-cdk/getting-started.html).

We will be using Typescript for these examples.

Before going any further clone this repository and run the following commands:

```
# from root of this repo
npm install
npm run build
```

#### EKS Cluster Control Plane - Stack 1

The first stack we will be creating is the EKS Cluster and Control Plane. This
stack is functionally very similar to the [AWS Getting Started Step 1](https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html#eks-create-cluster). 

The context allows you to set your desired EKS Cluster Name, but if you do not
alter `cdk.json` or pass in a command line argument the default will be used.
The stack will also create a VPC and NAT Gateway.

Using the defaults the command would be: 

```
# from root of this repo
cdk deploy EksCluster
# output will be similar to
 ⏳  Starting deployment of stack EksCluster...
[ 0/39] Mon Oct 22 2018 16:27:52 GMT-0700 (Pacific Daylight Time)  CREATE_IN_PROGRESS  [AWS::EC2::VPC] EksVpc4BB427FA
[ 0/39] Mon Oct 22 2018 16:27:52 GMT-0700 (Pacific Daylight Time)  CREATE_IN_PROGRESS  [AWS::IAM::Role] EksServiceRole2C9FD210
[ 0/39] Mon Oct 22 2018 16:27:52 GMT-0700 (Pacific Daylight Time)  CREATE_IN_PROGRESS  [AWS::EC2::EIP] EksVpcEksPublicSubnet2EIP6E00FE76
[ 0/39] Mon Oct 22 2018 16:27:52 GMT-0700 (Pacific Daylight Time)  CREATE_IN_PROGRESS  [AWS::EC2::InternetGateway] EksVpcIGWF47619EF
[ 0/39] Mon Oct 22 2018 16:27:52 GMT-0700 (Pacific Daylight Time)  CREATE_IN_PROGRESS  [AWS::EC2::EIP] EksVpcEksPublicSubnet3EIP7AA2ED70
[ 0/39] Mon Oct 22 2018 16:27:52 GMT-0700 (Pacific Daylight Time)  CREATE_IN_PROGRESS  [AWS::CDK::Metadata] CDKMetadata
# ... snip ...
 ✅  Deployment of stack EksCluster completed successfully, it has ARN arn:aws:cloudformation:us-west-2:12345678901:stack/EksCluster/00000000-aaaa-bbbb-cccc-dddddddddddd
EksCluster.EksVpcPublicSubnetIDs00000000 = subnet-11111111111111111,subnet-22222222222222222,subnet-33333333333333333
EksCluster.EksVpcVpcId11111111 = vpc-00000000000000000
EksCluster.EksExampleControlPlaneSGSecurityGroupIdeeeeeeee = sg-00000000000000000
EksCluster.EksVpcPrivateSubnetIDsffffffff = subnet-44444444444444444,subnet-55555555555555555,subnet-66666666666666666
```

The creation of the EKS cluster can take up to 15 minutes. After the stack
completes we can verify we have the credentials necessary to use `kubectl`.

```
# With AWS Credentials available to awscli
# if you changed the default name use it here
aws eks update-kubeconfig --name EksExample
kubectl get svc
# expected output
NAME       TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)         AGE
kube-dns   ClusterIP   172.20.0.10   <none>        53/UDP,53/TCP   1d
```

#### EKS Worker Nodes - Stack 2

Now that AWS is running our Kubernetes API Server and required components for
us, we need to create worker nodes. There are configuration options for the
workers, but for now if you just want to deploy some nodes the defaults will
work.

```
# from root of this repo
cdk deploy EksWorkers
# this output a similar success message at the end
```

The defaults for the workers can be found in the [cdk.json](cdk.json). The only
aspect that might be confusing is the optional [bastion](https://en.wikipedia.org/wiki/Bastion_host) configuration. 
If you want a bastion host the best option is to edit the [cdk.json](cdk.json)
file and the values for your configuration. The edits will be made to the
`bastion`, `key-name`, and `ssh-allowed-cidr` json keys. 

`key-name` is an [AWS EC2 Keypair](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html).

`ssh-allowed-cidr` is a list of IP addresses that will be allowed to SSH to the
bastion host. You can lookup your external IP via [AWS](http://checkip.amazonaws.com/). At a minimum you will want to add that IP as a `/32` below.

Your file might look similar to this: 

```json
{
  "app": "node bin/eks-example.js",
  "context": {
    "cluster-name": "EksExample",
    "key-name": "MyKeyPair",
    "node-group-max-size": 5,
    "node-group-min-size": 1,
    "node-group-desired-size": 3,
    "node-group-instance-type": "t3.medium",
    "bastion": true,
    "ssh-allowed-cidr": ["1.2.3.4/32"]
}
```

If you change these values after deploying you will need to re-deploy the stack
in order to apply the updates. That can be done:

```
npm run build
cdk diff EksWorkers
# make sure the diff matches what you think is happening
cdk deploy EksWorkers
# example success 
 ✅  Deployment of stack EksWorkers completed successfully, it has ARN arn:aws:cloudformation:us-west-2:012345678901:stack/EksWorkers/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
EksWorkers.WorkerRoleArn = arn:aws:iam::012345678901:role/EksWorkers-WorkersInstanceRoleRRRRRRRR-AAAAAAAAAAA
# note this ARN for the next step
```

Once you have your workers deployed we need to join them to the cluster. This
currently must be done using `kubectl`. In order to do this update the file in
this repo called [aws-auth-cm.yaml](aws-auth-cm.yaml) with the Role ARN from the
EksWorkers state output. Specifically replace this line with your value.

```
    - rolearn: '<your role arn here>'
```

This file gives the Kubernetes permission to join the cluster specifically to
the role attached to these nodes.

```
kubectl apply -f aws-auth-cm.yaml
kubectl get nodes --watch # this will follow the k8s events CTRL-C to break
# example output
NAME                                        STATUS     ROLES    AGE   VERSION
ip-10-0-15-168.us-west-2.compute.internal   NotReady   <none>   0s    v1.10.3
ip-10-0-28-14.us-west-2.compute.internal   NotReady   <none>   0s    v1.10.3
ip-10-0-28-14.us-west-2.compute.internal   NotReady   <none>   0s    v1.10.3
ip-10-0-19-99.us-west-2.compute.internal   NotReady   <none>   1s    v1.10.3
ip-10-0-19-99.us-west-2.compute.internal   NotReady   <none>   1s    v1.10.3
ip-10-0-31-23.us-west-2.compute.internal   NotReady   <none>   1s    v1.10.3
ip-10-0-31-23.us-west-2.compute.internal   NotReady   <none>   1s    v1.10.3
ip-10-0-17-255.us-west-2.compute.internal   NotReady   <none>   0s    v1.10.3
ip-10-0-17-255.us-west-2.compute.internal   NotReady   <none>   0s    v1.10.3
ip-10-0-15-168.us-west-2.compute.internal   NotReady   <none>   10s   v1.10.3
ip-10-0-28-14.us-west-2.compute.internal   NotReady   <none>   10s   v1.10.3
ip-10-0-19-99.us-west-2.compute.internal   NotReady   <none>   11s   v1.10.3
ip-10-0-31-23.us-west-2.compute.internal   NotReady   <none>   11s   v1.10.3
ip-10-0-17-255.us-west-2.compute.internal   NotReady   <none>   11s   v1.10.3
ip-10-0-15-168.us-west-2.compute.internal   Ready   <none>   20s   v1.10.3
ip-10-0-28-14.us-west-2.compute.internal   NotReady   <none>   20s   v1.10.3
ip-10-0-19-99.us-west-2.compute.internal   Ready   <none>   21s   v1.10.3
ip-10-0-31-23.us-west-2.compute.internal   Ready   <none>   21s   v1.10.3
ip-10-0-17-255.us-west-2.compute.internal   Ready   <none>   21s   v1.10.3
```

At this point you have working EKS Cluster to experiment with, but remember you
are being charged for these resources so you might want to clean up.

#### Cleaning Up the Example

The CDK comes equipped with destroy commands:

```
cdk destroy EksCluster
# follow the prompts
cdk destroy EksWorkers
```

That should delete all the resources we created in this example

#### CDK Issues 

During the development of this example I noted a couple of issues with the CDK.
The issues are in comments but for simple tracking you can check out these links
for issues I worked around in making this example work.
 * https://github.com/awslabs/aws-cdk/issues/623



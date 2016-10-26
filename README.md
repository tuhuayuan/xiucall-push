# xiucall-push

[![Travis branch](https://img.shields.io/travis/tuhuayuan/xiucall-push/master.svg?maxAge=2592000)](https://travis-ci.org/tuhuayuan/xiucall-push)
[![Codecov](https://img.shields.io/codecov/c/github/tuhuayuan/xiucall-push/master.svg?maxAge=2592000)](https://codecov.io/github/tuhuayuan/xiucall-push?branch=master)

这是使用SocketIO作为通讯协议的适合移动端应用和网页应用的推送服务器，采用REST风格的API发送JSON格式的消息，客户端采用Websocket方式连接到推送接口，采用Redis作为分布式协调缓存，MongoDB作为消息持久化存储。

## Architecture

架构图

```
+-----------------------+  +-----------------+
| redis cluster         |  | mongodb cluster |
| +--------+ +--------+ |  | +--------+      |
| | master | | slaves | |  | | primer |      |
| +--------+ +--------+ |  | +--------+      |
+-----------------------+  +-----------------+

+-----------------------+     +--------------+
|     Broker            +-----+  Queues      |
+------+-------------+--+     +--------------+
       |             |
+------+-------+   +-+-----------------------+
| Connectors   |   |         Server          |
+-+------------+   +-------+-----------------+
  |                        |
+-+---+  +-----------------+-----------------+
| LBS |  |         APP business server       |
+--+--+  +-----------------------------------+
   |
+--+----------+
|   Clients   |
+-------------+
```

主要组件

- Connector 客户端连接组件
- Broker    分布式消息中继器
- Queue     分布式消息队列
- Server    API服务器

## How to play

最少依赖
- redis
- mongodb

查看conf/default.json并且正确配置依赖服务的参数

```
make build
make test
```

## How to scale up

Connector包含一个Broker，Broker包含一个redis master连接，Broker创建的每个Queue包含一个共享redis master连接，以及一个redis slave连接。所以用户连接的上限与Connector的数量以及redis slave的数量有关。通过增加Connector和redis slave数量可以横向扩展服务的承载能力。

## Limit

如果采用sentinel方式部署redis，在切换master的过程中会堆积大量的redis请求数据包。采用mongodb作为存储，应为每个ClientID都会是一个单独collection，如果不对messages库分片会导致大量colletion在同一个库里面，这是不合理的库设计。

## Roadmap

 - 采用连续存储文件的方式存储message
 - 增加Router用于管理ClientID所在的Connector
 - 放弃Redis依赖通过Router和etcd实现分布式消协协同
 - 增加Docker镜像和Kubernetes部署清单

## License

MIT 
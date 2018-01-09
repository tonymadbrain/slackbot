const slack = require('@slack/client');
const fs = require('fs');
const request = require('request');

const RtmClient = slack.RtmClient;
const CLIENT_EVENTS = slack.CLIENT_EVENTS;
const RTM_EVENTS = slack.RTM_EVENTS;
const MemoryDataStore = slack.MemoryDataStore;
const token = process.env.SLACK_API_TOKEN;
const token2 = process.env.SLACK_API_TOKEN_LEGACY;
const configName = 'guardian.conf';

const rtm = new RtmClient(token, {
  logLevel: 'error', // check this out for more on logger: https://github.com/winstonjs/winston
  dataStore: new MemoryDataStore(), // pass a new MemoryDataStore instance to cache information
});

rtm.start();

rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, () => {
  console.log('RTM client authenticated!', new Date());
});

const channelsMap = {};
const config = JSON.parse(fs.readFileSync(configName));


//-----------------------------------------------------------
function getSlackUser(user) {
  const userobj = rtm.dataStore.getUserById(user);
  if (!userobj) {
    return null;
  }
  return userobj.name;
}
//-----------------------------------------------------------
function getSlackChannel(channelId) {
  const chanobj = rtm.dataStore.getChannelById(channelId);
  if (!chanobj) {
    return null;
  }
  return chanobj.name;
}

function processAdminMessage(message, msgChannelId) {
  const parts = message.split(' ');
  const cmd = parts[0];
  const channel = parts[1];
  const name = parts[2];

  if (cmd === 'add') {
    const user = rtm.dataStore.getUserByName(name);
    if (!user) {
      rtm.sendMessage(`failed. unknown user ${name}`, msgChannelId);
      return;
    }
    const channelId = rtm.dataStore.getChannelByName(channel);
    if (!channelId) {
      rtm.sendMessage(`failed. unknown channel ${channel}`, msgChannelId);
      return;
    }

    if (!config.protect[channel]) {
      config.protect[channel] = {};
    }
    config.protect[channel][name] = true;
    fs.writeFileSync(configName, JSON.stringify(config));
    rtm.sendMessage('ok', msgChannelId);
  }

  else if (cmd === 'list') {
    const msg = [];
    for (const chan in config.protect) {
      for (const usr in config.protect[chan]) {
        msg.push([chan, usr].join(' '));
      }
    }
    rtm.sendMessage(msg.join('\n'), msgChannelId);
  }

  else if (cmd === 'del') {
    const user = rtm.dataStore.getUserByName(name);
    if (!user) {
      rtm.sendMessage(`failed. unknown user ${name}`, msgChannelId);
      return;
    }
    const channelId = rtm.dataStore.getChannelByName(channel);
    if (!channelId) {
      rtm.sendMessage(`failed. unknown channel ${channel}`, msgChannelId);
      return;
    }

    delete config.protect[channel][name];
    if (Object.keys(config.protect[channel]).length === 0) {
      delete config.protect[channel];
    }
    fs.writeFileSync(configName, JSON.stringify(config));
    rtm.sendMessage('ok', msgChannelId);
  }
}

rtm.on(RTM_EVENTS.MESSAGE, (message) => {
  try {
    if (!message.user || !message.text) {
      return;
    }

    const slackuser = getSlackUser(message.user);
    if (!slackuser) {
      console.log('error getting slackuser', message);
      return;
    }
    const channel = getSlackChannel(message.channel);
    if (!channel) {
      if (config.admins[slackuser]) {
        processAdminMessage(message.text, message.channel);
        return;
      }
      console.log('error getting channel', message);
      return;
    }
    console.log(channel, slackuser, `thread:${Boolean(message.thread_ts)}`, message.text);

    if (!config.protect[channel] || config.protect[channel][slackuser] || message.thread_ts /* threads allowed */) {
      return;
    }

    console.log('DELETE MESSAGE ^^^');
    let url =  `https://slack.com/api/chat.delete?token=${token2}`;
    url += `&ts=${message.ts}`;
    url += `&channel=${message.channel}`;
    url += '&as_user=true&pretty=1';

    request(url, (err, data) => {
      if (err) {
        console.log(err);
      }
    });
  } catch (err) {
    console.error(err, err.stack);
  }
});


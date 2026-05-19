require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} = require("@discordjs/voice");
const play = require("play-dl");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const prefix = "!";

const queue = new Map();

client.once("ready", () => {
  console.log(`${client.user.tag} hazır`);
});

async function playSong(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!serverQueue) return;

  const stream = await play.stream(song.url);
  const resource = createAudioResource(stream.stream, {
    inputType: stream.type,
  });

  serverQueue.player.play(resource);
}

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // PLAY
  if (cmd === "play") {
    const voice = message.member.voice.channel;
    if (!voice) return message.reply("Voice’a gir.");

    const search = args.join(" ");
    if (!search) return message.reply("Şarkı yaz.");

    let songInfo;
    let song;

    if (search.includes("http")) {
      songInfo = await play.video_info(search);
      song = {
        title: songInfo.video_details.title,
        url: search,
      };
    } else {
      const result = await play.search(search, { limit: 1 });
      song = {
        title: result[0].title,
        url: result[0].url,
      };
    }

    let serverQueue = queue.get(message.guild.id);

    if (!serverQueue) {
      const player = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Play,
        },
      });

      const connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      serverQueue = {
        connection,
        player,
        songs: [],
      };

      queue.set(message.guild.id, serverQueue);

      player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        if (serverQueue.songs.length > 0) {
          playSong(message.guild, serverQueue.songs[0]);
        } else {
          serverQueue.connection.destroy();
          queue.delete(message.guild.id);
        }
      });

      serverQueue.connection.subscribe(player);
    }

    serverQueue.songs.push(song);
    message.reply(`➕ Eklendi: **${song.title}**`);

    if (serverQueue.songs.length === 1) {
      playSong(message.guild, song);
    }
  }

  // SKIP
  if (cmd === "skip") {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) return;
    serverQueue.player.stop();
    message.reply("⏭ Skip");
  }

  // STOP
  if (cmd === "stop") {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue) return;
    serverQueue.connection.destroy();
    queue.delete(message.guild.id);
    message.reply("⛔ Durdu");
  }

  // QUEUE
  if (cmd === "queue") {
    const serverQueue = queue.get(message.guild.id);
    if (!serverQueue || !serverQueue.songs.length)
      return message.reply("Boş");

    message.reply(
      serverQueue.songs.map((s, i) => `${i + 1}. ${s.title}`).join("\n")
    );
  }
});

client.login(process.env.TOKEN);

require("dotenv").config();
const _ = require("lodash");
const schedule = require("node-schedule");
const { organizeChannels } = require("./channelHelpers");
const { organizeRoles, getRole, roleNames } = require("./rolesHelpers");
const { resetNightPowers } = require("./commandHelpers");
const { characters } = require("./characterHelpers/characterUtil");
const {
  findGame,
  updateGame,
  findUser,
  getCountedVotes,
  deleteManyVotes,
  findSettings,
} = require("../werewolf_db");
const { vampiresAttack } = require("./characterHelpers/vampireHelpers");
const { parseSettingTime } = require("./checkTime");
const { endGuildJobs } = require("./schedulHelper");
const { copyCharacters } = require("./characterHelpers/doppelgangerHelper");
const { starveUser } = require("./characterHelpers/bakerHelper");
const { checkGame } = require("./endGameHelper");
const { removesDeadPermissions } = require("./deathHelper");
const { guardPlayers } = require("./characterHelpers/bodyguardHelper");
const {
  castWitchCurse,
  cursePlayers,
} = require("./characterHelpers/witchHelper");
const { killPlayers } = require("./characterHelpers/werewolfHelper");
const { returnMutedPlayers, mutePlayers } = require("./characterHelpers/grouchyGranny");
const { investigatePlayers } = require("./characterHelpers/seerHelper");

async function timeScheduling(interaction) {
  await endGuildJobs(interaction);
  const game = await findGame(interaction.guild.id);
  if (!game) {
    await interaction.reply({
      content: "No game to schedule",
      ephemeral: true,
    });
    return;
  }

  const settings = await findSettings(interaction.guild.id);

  if (!settings) {
    await interaction.reply({
      content: "run server setup",
      ephemeral: true,
    });
    return;
  }

  const day = parseSettingTime(settings.day_time);
  const night = parseSettingTime(settings.night_time);
  const { minute: warningMinute, hour: warningHour } = warningTime(night.hour, night.minute - 30)
  const { minute: killReminderMinute, hour: killReminderHour } = warningTime(night.hour, night.minute + 30)

  const nightRule = createScheduleRule(night.hour, night.minute) 
  const dayRule = createScheduleRule(day.hour, day.minute) 
  const voteWarningRule = createScheduleRule(warningHour, warningMinute) 
  const killReminderRule = createScheduleRule(killReminderHour, killReminderMinute) 

  console.log(`creating ${interaction.guild.id}-night`);
  schedule.scheduleJob(`${interaction.guild.id}-night`, nightRule, () =>
    nightTimeJob(interaction)
  );
  console.log(`creating ${interaction.guild.id}-day`);
  schedule.scheduleJob(`${interaction.guild.id}-day`, dayRule, () =>
    dayTimeJob(interaction)
  );
  console.log(`creating ${interaction.guild.id}-voting-warning`);
  schedule.scheduleJob(`${interaction.guild.id}-voting-warning`, voteWarningRule, () =>
    nightTimeWarning(interaction)
  );
  console.log(`creating ${interaction.guild.id}-kill-reminder`);
  schedule.scheduleJob(`${interaction.guild.id}-kill-reminder`, killReminderRule, () =>
    killReminder(interaction)
  );
  return true;
}

async function killReminder(interaction) {
  const guildId = interaction.guild.id;
  const game = await findGame(guildId);
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  const aliveRole = await getRole(interaction, roleNames.ALIVE);
  if (!game.user_death_id) {
    await organizedChannels.werewolves.send(
      `${aliveRole} it's dinnertime! We wouldn't want any hangry werewolves roaming the village, now would we? It's time to pick your prey and satisfy those growling stomachs. Happy hunting!`
    )
  }
  if (game.wolf_double_kill && !game.second_user_death_id) {
    await organizedChannels.werewolves.send(
      `${aliveRole} You've got a double serving on the menu tonight! But don't just feast on one unlucky soul, pick another before the moon sets. We wouldn't want you to miss out on dessert, would we? Use the \`/kill\` command again to select the second target`
    )
  }
}

async function nightTimeWarning(interaction) {
  const guildId = interaction.guild.id;
  const game = await findGame(guildId);
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  const aliveRole = await getRole(interaction, roleNames.ALIVE);
  if (game.first_night) {
    await organizedChannels.townSquare.send(
      `${aliveRole} This is the first night. Voting will start tomorrow`
    );
    return;
  }
  await organizedChannels.townSquare.send(
    `${aliveRole} 30 minutes until night`
  );
}

// Handles werewolf kill and vampire bites.
async function dayTimeJob(interaction) {
  const guildId = interaction.guild.id;
  const game = await findGame(guildId);

  if (game.is_day) {
    console.log("It is currently day skip");
    return;
  }

  await interaction.guild.members.fetch();
  const roles = await interaction.guild.roles.fetch();
  const organizedRoles = organizeRoles(roles);
  const channels = await interaction.guild.channels.fetch();
  const organizedChannels = organizeChannels(channels);
  let message = "";

  await copyCharacters(interaction);
  await cursePlayers(interaction);
  await returnMutedPlayers(interaction, guildId);
  await mutePlayers(interaction, guildId)

  const guardedIds = await guardPlayers(interaction);

  const deathIds = _.difference(
    [game.user_death_id, game.second_user_death_id],
    [...guardedIds, null]
  );
  const vampireDeathMessages = await vampiresAttack(
    interaction,
    deathIds,
    guardedIds
  );

  message += await killPlayers(interaction, deathIds);
  let starveMessage = ""
  if (game.is_baker_dead) {
    starveMessage = await starveUser(interaction, organizedRoles, deathIds);
  }

  await investigatePlayers(interaction)

  await updateGame(guildId, {
    user_death_id: null,
    second_user_death_id: null,
    wolf_double_kill: false,
    is_day: true,
    first_night: false,
  });

  const backUpMessage = "No one died from a werewolf last night.\n";

  organizedChannels.townSquare.send(
    `${message || backUpMessage}${starveMessage}${vampireDeathMessages}**It is day time**`
  );

  await checkGame(interaction);
}

// Handles town votes and death
async function nightTimeJob(interaction) {
  const guildId = interaction.guild.id;
  const members = await interaction.guild.members.fetch();
  const roles = await interaction.guild.roles.fetch();
  const organizedRoles = organizeRoles(roles);
  const channels = await interaction.guild.channels.fetch();
  const organizedChannels = organizeChannels(channels);
  const game = await findGame(guildId);
  const settings = await findSettings(guildId);

  if (game.first_night) {
    await updateGame(guildId, {
      is_day: false,
    });
    organizedChannels.werewolves.send(
      "This is the first night. Choose someone to kill with the `/kill` command"
    );
    organizedChannels.bodyguard.send(
      "This is the first night. Choose someone to guard with the `/guard` command"
    );
    organizedChannels.seer.send(
      "This is the first night. Choose someone to see with the `/investigate` command"
    );
    organizedChannels.witch.send(
      "This is the first night. Choose someone to curse with the `/curse` command"
    );
    organizedChannels.vampires.send(
      "This is the first night. Choose someone to bite with the `/vampire_bite` command"
    );
    return;
  }
  if (!game.is_day) {
    console.log("It is currently night skip");
    return;
  }
  let message;

  const cursor = await getCountedVotes(guildId);
  const allVotes = await cursor.toArray();

  let topVotes = [];
  let topCount = 0;

  _.forEach(allVotes, (vote) => {
    if (vote.count >= topCount) {
      topVotes.push(vote);
      topCount = vote.count;
    }
  });

  const voteWinner = _.sample(topVotes);
  await deleteManyVotes({ guild_id: guildId });
  await resetNightPowers(guildId);
  if (!voteWinner) {
    await updateGame(guildId, {
      is_day: false,
    });
    organizedChannels.townSquare.send("No one has voted...\nIt is night");
    return;
  }
  const deadUser = await findUser(voteWinner._id.voted_user_id, guildId);
  const deadMember = members.get(voteWinner._id.voted_user_id);

  let cursedMessage = "";

  if (deadUser.character === characters.WITCH) {
    cursedMessage = await castWitchCurse(interaction, organizedRoles);
  }

  const deathCharacter = await removesDeadPermissions(
    interaction,
    deadUser,
    deadMember,
    organizedRoles
  );

  if (topVotes.length > 1) {
    message = `There was a tie so I randomly picked ${deadMember} to die\n`;
  } else {
    message = `The town has decided to hang ${deadMember}\n`;
  }

  let deathMessage = settings.hard_mode ? '' : `The town has killed a **${deathCharacter}**\n`;

  if (deadUser.character === characters.HUNTER) {
    deathMessage = `The town has injured the **${deathCharacter}**\n${deadMember} you don't have long to live. Grab your gun and \`/shoot\` someone.\n`;
  }

  await updateGame(guildId, {
    is_day: false,
  });

  organizedChannels.townSquare.send(
    `${message}${deathMessage}${cursedMessage}**It is night time**`
  );

  await checkGame(interaction);
}

function warningTime(hour, minute) {
  if (minute < 0) {
    minute = 60 + minute;
    hour -= 1;
    if (hour < 0) {
      hour = 23;
    }
  }

  if (minute > 60) {
    minute = minute - 60;
    hour += 1;
    if (hour > 24) {
      hour = 0;
    }
  }

  return {hour, minute}
}

function createScheduleRule(hour, minute) {
  const scheduleRule = new schedule.RecurrenceRule();
  scheduleRule.minute = minute;
  scheduleRule.hour = hour;
  scheduleRule.tz = process.env.TIME_ZONE_TZ;
}

module.exports = {
  timeScheduling,
  dayTimeJob,
  nightTimeJob,
};

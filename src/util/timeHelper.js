require("dotenv").config();
const _ = require("lodash");
const schedule = require("node-schedule");
const {
  organizeChannels,
  removeChannelPermissions,
  giveSeerChannelPermissions,
} = require("./channelHelpers");
const { organizeRoles, removeGameRolesFromMembers } = require("./rolesHelpers");
const { getAliveUsersIds } = require("./userHelpers");
const {
  removeUsersPermissions,
  resetNightPowers,
  gameCommandPermissions,
  addApprenticeSeePermissions,
  characters,
} = require("./commandHelpers");
const {
  findGame,
  updateGame,
  deleteGame,
  findUser,
  findOneUser,
  updateUser,
  findUsersWithIds,
  deleteAllUsers,
  getCountedVotes,
  deleteAllVotes,
  findAllUsers,
} = require("../werewolf_db");

async function timeScheduling(interaction, dayHour, nightHour) {
  await schedule.gracefulShutdown();
  const game = await findGame(interaction.guild.id);
  if (!game) {
    await interaction.reply({
      content: "No game to schedule",
      ephemeral: true,
    });
    return;
  }
  // TODO: when a user can set the time and they set it at midnight than we will need to wrap around to 23
  const warningHour = nightHour - 1;

  const nightRule = new schedule.RecurrenceRule();
  const dayRule = new schedule.RecurrenceRule();
  const warningRule = new schedule.RecurrenceRule();
  nightRule.minute = 0;
  nightRule.hour = nightHour;
  nightRule.tz = process.env.TIME_ZONE_TZ;
  dayRule.minute = 0;
  dayRule.hour = dayHour;
  dayRule.tz = process.env.TIME_ZONE_TZ;
  warningRule.minute = 30;
  warningRule.hour = warningHour;
  warningRule.tx = process.env.TIME_ZONE_TZ;
  schedule.scheduleJob(nightRule, () => nightTimeJob(interaction));
  schedule.scheduleJob(dayRule, () => dayTimeJob(interaction));
  schedule.scheduleJob(warningRule, () => nightTimeWarning(interaction));
  return true;
}

async function nightTimeWarning(interaction) {
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  organizedChannels.townSquare.send("30 minutes until night");
}

// Handles werewolf kill.
async function dayTimeJob(interaction) {
  const guildId = interaction.guild.id;
  const game = await findGame(guildId);

  if (game.is_day) {
    console.log("It is currently day skip");
    return;
  }

  const client = interaction.guild.client;
  const members = await interaction.guild.members.fetch();
  const roles = await interaction.guild.roles.fetch();
  const organizedRoles = organizeRoles(roles);
  const channels = client.channels.cache;
  const organizedChannels = organizeChannels(channels);

  // resetting bodyguards last user guarded if they didn't use their power.
  if (!game.user_guarded_id || !game.user_protected_id) {
    const cursor = await findAllUsers(guildId);
    const allUsers = await cursor.toArray();
    const bodyguard = _.head(
      allUsers.filter((user) => user.character === characters.BODYGUARD)
    );
    if (bodyguard?.guard) {
      // bodyguard did not use power last night
      await updateUser(bodyguard.user_id, guildId, {
        last_user_guard_id: null,
      });
    }
  }

  let message = "No one died from a werewolf last night.\n";

  if (game.user_death_id) {
    if (
      game.user_death_id !== game.user_protected_id &&
      game.user_death_id !== game.user_guarded_id
    ) {
      const deadUser = await findUser(game.user_death_id, guildId);
      const deadMember = members.get(game.user_death_id);
      const deathCharacter = await removesDeadPermissions(
        interaction,
        deadUser,
        deadMember,
        organizedRoles
      );
      // TODO: add check to see if it was the hunter who died
      message = `Last night the ${deathCharacter} named ${deadMember} was killed by the werewolves.\n`;
    }
    if (game.is_baker_dead) {
      message += await starveUser(
        interaction,
        organizedRoles,
        game.user_death_id
      );
    }
  } else if (game.is_baker_dead) {
    message += await starveUser(interaction, organizedRoles);
  }

  await updateGame(guildId, {
    user_death_id: null,
    user_protected_id: null,
    user_guarded_id: null,
    is_day: true,
    first_night: false,
  });

  organizedChannels.townSquare.send(`${message} It is day time`);

  await checkGame(
    interaction,
    members,
    organizedRoles.alive,
    roles,
    guildId,
    organizedChannels.townSquare
  );
}

// Handles town votes and death
async function nightTimeJob(interaction) {
  const guildId = interaction.guild.id;
  const client = interaction.guild.client;
  const members = await interaction.guild.members.fetch();
  const roles = await interaction.guild.roles.fetch();
  const organizedRoles = organizeRoles(roles);
  const channels = await client.channels.cache;
  const organizedChannels = organizeChannels(channels);
  const game = await findGame(guildId);

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
      "This is the first night. Choose someone to see with the `/see` command"
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

  let killedRandomly = false;
  if (topVotes.length > 1) {
    killedRandomly = true;
  }
  const voteWinner = _.head(_.shuffle(topVotes));

  await deleteAllVotes(guildId);
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

  const deathCharacter = await removesDeadPermissions(
    interaction,
    deadUser,
    deadMember,
    organizedRoles
  );

  // TODO: add check to see if it was the hunter who died

  if (killedRandomly) {
    message = `There was a tie so I randomly picked ${deadMember} to die`;
  } else {
    message = `The town has decided to hang ${deadMember}`;
  }

  const deathMessage = `The town has killed a ${deathCharacter}`;
  await updateGame(guildId, {
    is_day: false,
  });

  organizedChannels.townSquare.send(
    `${message}\n${deathMessage}\n It is night time`
  );

  await checkGame(
    interaction,
    members,
    organizedRoles.alive,
    roles,
    guildId,
    organizedChannels.townSquare
  );
}

async function removesDeadPermissions(
  interaction,
  deadUser,
  deadMember,
  organizedRoles
) {
  deadMember.roles.remove(organizedRoles.alive);
  deadMember.roles.add(organizedRoles.dead);
  // removes deadUser character command and channel Permissions
  await removeUsersPermissions(interaction, deadUser);
  await removeChannelPermissions(interaction, deadMember);
  await updateUser(deadUser.user_id, interaction.guild.id, { dead: true });

  let deadCharacter = deadUser.character;

  if (deadCharacter === characters.LYCAN) {
    deadCharacter = characters.VILLAGER;
  } else if (deadCharacter === characters.BAKER) {
    await updateGame(interaction.guild.id, {
      is_baker_dead: true,
    });
  }

  if (deadCharacter === characters.SEER) {
    const apprenticeSeerUser = await findOneUser({
      guild_id: interaction.guild.id,
      character: characters.APPRENTICE_SEER,
    });

    if (apprenticeSeerUser && !apprenticeSeerUser.dead) {
      await updateUser(apprenticeSeerUser.user_id, interaction.guild.id, {
        character: characters.SEER,
      });
      const discordApprenticeUser = interaction.guild.members.cache.get(
        apprenticeSeerUser.user_id
      );
      await giveSeerChannelPermissions(interaction, discordApprenticeUser);
      await addApprenticeSeePermissions(interaction, apprenticeSeerUser);
    }
  }

  return deadCharacter;
}

async function checkGame(
  interaction,
  members,
  aliveRole,
  roles,
  guildId,
  townSquare
) {
  aliveMembers = members
    .map((member) => {
      if (member._roles.includes(aliveRole.id)) {
        return member;
      }
    })
    .filter((m) => m);

  let werewolfCount = 0;
  let villagerCount = 0;

  await Promise.all(
    aliveMembers.map(async (member) => {
      const dbUser = await findUser(member.user.id, guildId);
      if (dbUser.character === characters.WEREWOLF) {
        werewolfCount += 1;
      } else {
        villagerCount += 1;
      }
    })
  );

  if (werewolfCount === 0) {
    townSquare.send("There are no more werewolves. **Villagers Win!**");
    await endGame(interaction, guildId, roles, members);
  }

  if (werewolfCount >= villagerCount) {
    townSquare.send("Werewolves out number the villagers. **Werewolves Win!**");
    await endGame(interaction, guildId, roles, members);
  }
}

async function starveUser(interaction, organizedRoles, werewolfKillId) {
  let aliveUserIds = await getAliveUsersIds(interaction);

  const cursor = await findUsersWithIds(interaction.guild.id, aliveUserIds);
  let aliveUsers = await cursor.toArray();

  if (werewolfKillId) {
    aliveUsers = _.filter(
      aliveUsers,
      (user) =>
        user.user_id != werewolfKillId || user.character != characters.WEREWOLF
    );
  } else {
    aliveUsers = _.filter(
      aliveUsers,
      (user) => user.character != characters.WEREWOLF
    );
  }

  const starvedUser = _.head(_.shuffle(aliveUsers));
  const starvedMember = interaction.guild.members.cache.get(
    starvedUser.user_id
  );
  const starvedCharacter = await removesDeadPermissions(
    interaction,
    starvedUser,
    starvedMember,
    organizedRoles
  );

  return `The **${starvedCharacter}** named ${starvedMember} has died from starvation\n`;
}

async function endGame(interaction, guildId, roles, members) {
  // stop scheduling day and night

  // removing all users game command permissions
  const cursor = await findAllUsers(guildId);
  const allUsers = await cursor.toArray();
  await gameCommandPermissions(interaction, allUsers, false);

  // remove all discord roles from players
  await removeGameRolesFromMembers(members, roles);

  // delete all game info from database
  await deleteAllUsers(guildId);
  await deleteGame(guildId);
  await deleteAllVotes(guildId);
  await schedule.gracefulShutdown();
}

module.exports = {
  timeScheduling,
  dayTimeJob,
  nightTimeJob,
};

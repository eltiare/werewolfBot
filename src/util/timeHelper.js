require("dotenv").config();
const _ = require("lodash");
const schedule = require("node-schedule");
const {
  organizeChannels,
  removeChannelPermissions,
  giveChannelPermissions,
} = require("./channelHelpers");
const {
  organizeRoles,
  removeGameRolesFromMembers,
  getRole,
  roleNames,
} = require("./rolesHelpers");
const {
  getAliveUsersIds,
  getAliveMembers,
  castWitchCurse,
  removeUserVotes,
} = require("./userHelpers");
const { resetNightPowers, characters } = require("./commandHelpers");
const {
  findGame,
  updateGame,
  deleteGame,
  findUser,
  updateUser,
  findUsersWithIds,
  deleteAllUsers,
  getCountedVotes,
  findManyUsers,
  deleteManyVotes,
  findSettings,
} = require("../werewolf_db");
const { vampiresAttack } = require("./characterHelpers/vampireHelpers");
const { parseSettingTime } = require("./checkTime");
const { endGuildJobs } = require("./schedulHelper");
const { teams, calculateScores } = require("./scoreSystem");
const { copyCharacter } = require("./characterHelpers/doppelgangerHelper");
const { starveUser, checkBakers } = require("./characterHelpers/bakerHelper");
const { shuffleSeers } = require("./characterHelpers/seerHelper");

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

  let warningHour = night.hour;
  let warningMinute = night.minute - 30;

  if (warningMinute < 0) {
    warningMinute = 60 + warningMinute;
    warningHour -= 1;
    if (warningHour < 0) {
      warningHour = 23;
    }
  }

  const nightRule = new schedule.RecurrenceRule();
  const dayRule = new schedule.RecurrenceRule();
  const warningRule = new schedule.RecurrenceRule();
  nightRule.minute = night.minute;
  nightRule.hour = night.hour;
  nightRule.tz = process.env.TIME_ZONE_TZ;
  dayRule.minute = day.minute;
  dayRule.hour = day.hour;
  dayRule.tz = process.env.TIME_ZONE_TZ;
  warningRule.minute = warningMinute;
  warningRule.hour = warningHour;
  warningRule.tz = process.env.TIME_ZONE_TZ;
  schedule.scheduleJob(`${interaction.guild.id}-night`, nightRule, () =>
    nightTimeJob(interaction)
  );
  schedule.scheduleJob(`${interaction.guild.id}-day`, dayRule, () =>
    dayTimeJob(interaction)
  );
  schedule.scheduleJob(`${interaction.guild.id}-warning`, warningRule, () =>
    nightTimeWarning(interaction)
  );
  return true;
}

async function nightTimeWarning(interaction) {
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  const aliveRole = await getRole(interaction, roleNames.ALIVE);
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

  const members = await interaction.guild.members.fetch();
  const roles = await interaction.guild.roles.fetch();
  const organizedRoles = organizeRoles(roles);
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);

  const cursorDoppelganger = await findManyUsers({
    guild_id: guildId,
    character: characters.DOPPELGANGER,
  });

  const doppelgangers = await cursorDoppelganger.toArray();
  await Promise.all(
    _.map(doppelgangers, async (doppelganger) => {
      await copyCharacter(
        interaction,
        doppelganger.user_id,
        doppelganger.copy_user_id
      );
    })
  );

  const cursorWitches = await findManyUsers({
    guild_id: guildId,
    character: characters.WITCH,
  });
  const witches = await cursorWitches.toArray();

  await Promise.all(
    _.map(witches, async (witch) => {
      if (witch.target_cursed_user_id) {
        await updateUser(witch.target_cursed_user_id, guildId, {
          is_cursed: true,
        });
        await updateUser(witch.user_id, guildId, {
          target_cursed_user_id: null,
        });
        organizedChannels.witch.send(
          `${members.get(witch.user_id)} have successfully cursed ${members.get(
            witch.target_cursed_user_id
          )}`
        );
      }
    })
  );

  let message = "";

  const cursorBodyguards = await findManyUsers({
    guild_id: guildId,
    character: characters.BODYGUARD,
  });
  const bodyGuards = await cursorBodyguards.toArray();

  const guardedIds = await Promise.all(
    _.map(bodyGuards, async (bodyguard) => {
      const guardedUserId = bodyguard.guarded_user_id;
      if (!guardedUserId) {
        return;
      }

      const guardedUser = await findUser(guardedUserId, guildId);
      if (
        guardedUser.character === characters.MASON &&
        !bodyguard.onMasonChannel
      ) {
        await updateUser(bodyguard.user_id, guildId, {
          onMasonChannel: true,
        });
        const bodyguardMember = members.get(bodyguard.user_id);
        await giveChannelPermissions({
          interaction,
          user: bodyguardMember,
          character: characters.MASON,
          message: `The bodyguard ${bodyguardMember} has joined!`,
        });
      }

      await updateUser(bodyguard.user_id, guildId, {
        last_guarded_user_id: guardedUserId,
        guarded_user_id: null,
      });

      if (
        guardedUser.character === characters.VAMPIRE ||
        guardedUser.character === characters.WITCH
      ) {
        organizedChannels.bodyguard.send(
          `While guarding ${members.get(
            guardedUserId
          )} you notice something off about them. They are not a villager.. They are a vampire!`
        );
      }

      return guardedUserId;
    })
  );

  const deathIds = _.difference(
    [game.user_death_id, game.second_user_death_id],
    [...guardedIds, null]
  );

  const vampireDeathMessages = await vampiresAttack(
    interaction,
    deathIds,
    guardedIds,
    removesDeadPermissions
  );

  if (!_.isEmpty(deathIds)) {
    const cursor = await findUsersWithIds(guildId, deathIds);
    const deadUsers = await cursor.toArray();
    await Promise.all(
      _.map(deadUsers, async (deadUser) => {
        const deadMember = members.get(deadUser.user_id);
        let isDead = true;

        if (deadUser.character === characters.CURSED) {
          // join werewolf team
          await updateUser(deadUser.user_id, interaction.guild.id, {
            character: characters.WEREWOLF,
          });
          const discordDeadUser = interaction.guild.members.cache.get(
            deadUser.user_id
          );
          await giveChannelPermissions({
            interaction,
            user: discordDeadUser,
            character: characters.WEREWOLF,
          });
          await organizedChannels.werewolves.send(
            `${discordDeadUser} did not die and has turned into a werewolf! :wolf:`
          );
          isDead = false;
        } else if (deadUser.character === characters.WITCH) {
          organizedChannels.werewolves.send(
            `You did not kill ${discordDeadUser} because they are the witch!`
          );
          isDead = false;
        }

        if (isDead) {
          const deathCharacter = await removesDeadPermissions(
            interaction,
            deadUser,
            deadMember,
            organizedRoles
          );
          if (deathCharacter === characters.HUNTER) {
            message += `Last night the werewolves injured the **${
              deadUser.is_vampire ? `vampire ${deathCharacter}` : deathCharacter
            }**\n${deadMember} you don't have long to live. Grab your gun and \`/shoot\` someone.\n`;
          } else {
            message += `Last night the **${
              deadUser.is_vampire ? `vampire ${deathCharacter}` : deathCharacter
            }** named ${deadMember} was killed by the werewolves.\n`;
          }
        }
      })
    );

    if (game.is_baker_dead) {
      message += await starveUser(interaction, organizedRoles, deathIds);
    }
  } else if (game.is_baker_dead) {
    message += await starveUser(interaction, organizedRoles);
  }

  await updateGame(guildId, {
    user_death_id: null,
    second_user_death_id: null,
    wolf_double_kill: false,
    is_day: true,
    first_night: false,
  });

  const backUpMessage = "No one died from a werewolf last night.\n";

  organizedChannels.townSquare.send(
    `${message || backUpMessage}${vampireDeathMessages}**It is day time**`
  );

  await checkGame(interaction);
}

// Handles town votes and death
async function nightTimeJob(interaction) {
  const guildId = interaction.guild.id;
  const members = await interaction.guild.members.fetch();
  const roles = await interaction.guild.roles.fetch();
  const organizedRoles = organizeRoles(roles);
  const channels = await interaction.guild.channels.cache;
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

  let killedRandomly = false;
  if (topVotes.length > 1) {
    killedRandomly = true;
  }
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
    cursedMessage = await castWitchCurse(
      interaction,
      organizedRoles,
      removesDeadPermissions
    );
  }

  const deathCharacter = await removesDeadPermissions(
    interaction,
    deadUser,
    deadMember,
    organizedRoles
  );

  if (killedRandomly) {
    message = `There was a tie so I randomly picked ${deadMember} to die`;
  } else {
    message = `The town has decided to hang ${deadMember}`;
  }

  let deathMessage = `The town has killed a **${
    deadUser.is_vampire ? `vampire ${deathCharacter}` : deathCharacter
  }**`;

  if (deathCharacter === characters.HUNTER) {
    deathMessage = `The town has injured the **${
      deadUser.is_vampire ? `vampire ${deathCharacter}` : deathCharacter
    }**\n${deadMember} you don't have long to live. Grab your gun and \`/shoot\` someone.`;
  }

  await updateGame(guildId, {
    is_day: false,
  });

  organizedChannels.townSquare.send(
    `${message}\n${deathMessage}\n${cursedMessage}\n**It is night time**`
  );

  await checkGame(interaction);
}

async function removesDeadPermissions(
  interaction,
  deadUser,
  deadMember,
  organizedRoles
) {
  const guildId = interaction.guild.id;
  let deadCharacter = deadUser.character;
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  if (deadCharacter === characters.HUNTER && !deadUser.is_dead) {
    await updateUser(deadUser.user_id, guildId, {
      can_shoot: true,
      is_dead: true,
    });

    const currentDate = new Date();
    const hours = 4;
    const shootingLimit = new Date(
      currentDate.setHours(currentDate.getHours() + hours)
    );

    schedule.scheduleJob(
      `${guildId}-hunter-${deadUser.user_id}`,
      shootingLimit,
      () => hunterShootingLimitJob(interaction, deadMember, organizedRoles)
    );

    return deadCharacter;
  }

  // removes deadUser character command and channel Permissions
  deadMember.roles.remove(organizedRoles.alive);
  deadMember.roles.add(organizedRoles.dead);
  await removeChannelPermissions(interaction, deadMember);
  await removeUserVotes(guildId, deadUser.user_id);
  await updateUser(deadUser.user_id, guildId, { is_dead: true });

  if (deadCharacter === characters.LYCAN) {
    deadCharacter = characters.VILLAGER;
  } else if (deadCharacter === characters.BAKER) {
    await checkBakers(guildId, organizedChannels.townSquare);
  } else if (deadCharacter === characters.WEREWOLF && deadUser.is_cub) {
    await updateGame(guildId, {
      wolf_double_kill: true,
    });
    await organizedChannels.werewolves.send(
      `The Werewolf Cub name ${deadMember} has been killed :rage:\nTonight you will be able to target two villagers!\nhttps://tenor.com/86LT.gif`
    );
    deadCharacter = characters.CUB;
  } else if (deadCharacter === characters.SEER) {
    await shuffleSeers(interaction, organizedChannels);
  }

  return deadCharacter;
}

async function checkGame(interaction) {
  const members = interaction.guild.members.cache;
  const guildId = interaction.guild.id;
  const roles = interaction.guild.roles.cache;
  const aliveMembers = await getAliveMembers(interaction);
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);

  let werewolfCount = 0;
  let villagerCount = 0;
  let vampireCount = 0;

  await Promise.all(
    aliveMembers.map(async (member) => {
      const dbUser = await findUser(member.user.id, guildId);
      if (
        dbUser.character === characters.WEREWOLF ||
        dbUser.character === characters.WITCH
      ) {
        werewolfCount += 1;
      } else if (dbUser.is_vampire) {
        vampireCount += 1;
      } else {
        villagerCount += 1;
      }
    })
  );

  let isGameOver = false;
  let winner;

  if (werewolfCount === 0 && vampireCount === 0) {
    organizedChannels.townSquare.send(
      "There are no more werewolves or vampires. **Villagers Win!**"
    );
    isGameOver = true;
    winner = teams.VILLAGERS;
  } else if (werewolfCount >= villagerCount + vampireCount) {
    organizedChannels.townSquare.send(
      "Werewolves out number the villagers and vampires. **Werewolves Win!**"
    );
    isGameOver = true;
    winner = teams.WEREWOLVES;
  } else if (vampireCount >= villagerCount + werewolfCount) {
    organizedChannels.townSquare.send(
      "Vampires out number the villagers and werewolves. **Vampires Win!**"
    );
    isGameOver = true;
    winner = teams.VAMPIRES;
  }

  const scoreData = { winner };

  if (isGameOver) {
    await endGame(interaction, roles, members, scoreData);
  }
}

async function hunterShootingLimitJob(
  interaction,
  deadHunterMember,
  organizedRoles
) {
  const deadDbHunter = await findUser(
    deadHunterMember.user.id,
    interaction.guild.id
  );
  if (!deadDbHunter.can_shoot) {
    return;
  }
  // get all alive users but not the hunter
  let aliveUserIds = await getAliveUsersIds(interaction);

  aliveUserIds = _.filter(aliveUserIds, (id) => id != deadHunterMember.user.id);

  const shotUserId = _.sample(aliveUserIds);
  const shotUser = await findUser(shotUserId, interaction.guild.id);
  const shotMember = interaction.guild.members.cache.get(shotUserId);
  // kill hunter
  await removesDeadPermissions(
    interaction,
    deadDbHunter,
    deadHunterMember,
    organizedRoles
  );
  // kill targeted user
  const deadCharacter = await removesDeadPermissions(
    interaction,
    shotUser,
    shotMember,
    organizedRoles
  );

  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  let message = "";
  if (deadCharacter === characters.HUNTER) {
    message = `${shotMember} you have been injured and don't have long to live. Grab you gun and \`/shoot\` someone.`;
  }
  await organizedChannels.townSquare.send(
    `${deadHunterMember} didn't have time to shoot and died. They dropped their gun and it shot the ${
      shotUser.is_vampire ? `vampire ${deadCharacter}` : deadCharacter
    } named ${shotMember}\n${message}\n`
  );
  await checkGame(interaction);
}

async function endGame(interaction, roles, members, scoreData) {
  const guildId = interaction.guild.id;
  // remove all discord roles from players
  await removeGameRolesFromMembers(members, roles);

  await calculateScores(interaction, scoreData);

  // delete all game info from database
  await deleteAllUsers(guildId);
  await deleteGame(guildId);
  await deleteManyVotes({ guild_id: guildId });
  await endGuildJobs(interaction);
}

module.exports = {
  timeScheduling,
  dayTimeJob,
  nightTimeJob,
  removesDeadPermissions,
  checkGame,
};

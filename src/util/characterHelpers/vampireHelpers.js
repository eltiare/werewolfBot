const _ = require("lodash");
const {
  findUser,
  findManyUsers,
  updateUser,
  findSettings,
} = require("../../werewolf_db");
const { characters } = require("./characterUtil");
const {
  organizeChannels,
  giveChannelPermissions,
} = require("../channelHelpers");
const { removesDeadPermissions, WaysToDie } = require("../deathHelper");
const { vampireDeathMessage } = require("../botMessages/deathMessages");
const { PowerUpNames } = require("../powerUpHelpers");

async function vampiresAttack(interaction, werewolfKillIds, guardedIds) {
  const members = interaction.guild.members.cache;
  const channels = interaction.guild.channels.cache;
  const organizedChannels = organizeChannels(channels);
  const guildId = interaction.guild.id;
  const settings = await findSettings(guildId);
  const cursor = await findManyUsers({
    guild_id: guildId,
    is_vampire: true,
    is_dead: false,
  });
  const vampires = await cursor.toArray();

  const usersBittenById = new Map();

  const vampireDeathMessages = await Promise.all(
    _.map(vampires, async (vampire) => {
      if (!vampire.bite_user_id) {
        return null;
      }

      const victim = await findUser(vampire.bite_user_id, guildId);
      const victimMember = members.get(vampire.bite_user_id);
      const vampireMember = members.get(vampire.user_id);
      const isVampireKing = vampire.character === characters.VAMPIRE;
      await updateUser(vampire.user_id, guildId, { bite_user_id: null });

      const guarded = _.includes(guardedIds, vampire.bite_user_id);
      const protectedMemberMessage = `${vampireMember} you were not able to bite ${victimMember}. They must have been protected or are able to defend your attacks.`;

      if (
        victim.character === characters.WITCH ||
        victim.character === characters.BODYGUARD ||
        victim.character === characters.CHAOS_DEMON ||
        guarded
      ) {
        await organizedChannels.vampires.send(protectedMemberMessage);
        if (guarded) {
          await organizedChannels.bodyguard.send(
            `While guarding ${victimMember} you saw a vampire about to attack!\nUsing your vampire hunting skills you scared away the vampire.\n${vampireMember} is a vampire!`
          );
        }
        return null;
      }

      let biteCount = usersBittenById.get(victim.user_id);
      if (!biteCount) {
        usersBittenById.set(victim.user_id, victim.vampire_bites);
        biteCount = victim.vampire_bites;
      }

      const werewolfAttacked = _.includes(
        werewolfKillIds,
        vampire.bite_user_id
      );
      const vampireKilled = _.includes(werewolfKillIds, vampire.user_id);
      if (!victim.is_vampire && !vampireKilled) {
        if (bitePlayer(victim) && !werewolfAttacked) {
          if (
            isVampireKing &&
            vampire.first_bite &&
            settings.allow_first_bite
          ) {
            biteCount += 2;
            await updateUser(vampire.user_id, guildId, { first_bite: false });
          } else {
            biteCount += 1;
          }
          usersBittenById.set(victim.user_id, biteCount);
          await organizedChannels.vampires.send(
            `${vampireMember} you have successfully bitten ${victimMember}`
          );
          if (biteCount >= 2) {
            await transformIntoVampire(interaction, victim, victimMember);
          }
        } else if (
          isVampireKing &&
          (victim.character !== characters.WEREWOLF ||
            settings.king_bite_wolf_safe) &&
          (werewolfAttacked || settings.king_victim_attack_safe)
        ) {
          await organizedChannels.vampires.send(protectedMemberMessage);
        } else {
          const deadCharacter = await removesDeadPermissions(
            interaction,
            vampire,
            vampireMember,
            WaysToDie.WEREWOLF
          );
          if (werewolfAttacked) {
            await organizedChannels.vampires.send(
              `${vampireMember} tried to bite ${victimMember} but a werewolf was also attacking ${victimMember}!`
            );
          } else {
            await organizedChannels.vampires.send(
              `${vampireMember} Your attempt to bite ${victimMember} has backfired! Unbeknownst to you, ${victimMember} is a werewolf, and this deadly encounter has led to your demise.`
            );
          }
          if (deadCharacter === PowerUpNames.SHIELD) {
            await organizedChannels.vampires.send(
              `🛡️WAIT! ${vampireMember} has a shield! It protected them from death!🛡️`
            );
          }
          return await vampireDeathMessage({
            werewolfAttacked,
            victim,
            deadCharacter,
            vampire,
            vampireMember,
          });
        }
      }
    })
  );

  for (const [userId, bites] of usersBittenById.entries()) {
    await updateUser(userId, guildId, { vampire_bites: bites });
  }

  await sendBittenUsersMessage(interaction, organizedChannels.vampires);

  return _.compact(vampireDeathMessages).join();
}

async function sendBittenUsersMessage(interaction, vampireChannel) {
  const bittenDbUsers = await getBittenUsers(interaction);
  if (_.isEmpty(bittenDbUsers)) {
    return;
  }
  const members = interaction.guild.members.cache;
  const bittenMessage = _.map(
    bittenDbUsers,
    (dbUser) => `* ${members.get(dbUser.user_id)}`
  ).join("\n");
  await vampireChannel.send(`### Players bitten\n${bittenMessage}`);
}

async function getBittenUsers(interaction) {
  const cursor = await findManyUsers({
    guild_id: interaction.guild.id,
    is_vampire: false,
    is_dead: false,
    vampire_bites: 1,
  });
  return cursor.toArray();
}

async function transformIntoVampire(interaction, user, userMember) {
  const is_mutated = user.character === characters.MUTATED;
  const settings = await findSettings(interaction.guild.id);

  await updateUser(user.user_id, interaction.guild.id, {
    is_vampire: true,
    first_bite: is_mutated,
    character: is_mutated ? characters.VAMPIRE : user.character,
  });

  const vampireType =
    is_mutated && settings.allow_first_bite
      ? "vampire king! Their first successful bite will transform a player into a vampire."
      : "vampire! It will take them two bites to transform a player into a vampire.";

  await giveChannelPermissions({
    interaction,
    user: userMember,
    character: characters.VAMPIRE,
    message: `${userMember} has turned into a ${vampireType}`,
  });
}

function bitePlayer(user) {
  if (user.character === characters.WEREWOLF) {
    return false;
  }
  return true;
}

module.exports = {
  transformIntoVampire,
  bitePlayer,
  vampiresAttack,
};

const _ = require("lodash");
const { findSettings } = require("../werewolf_db");
const { characterInfoMap, characters, teams, getCards} = require("./characterHelpers/characterUtil");
const { DeckBalancer } = require("./characterHelpers/deckBalancer");


function createDeck(characterCards, numberOfPlayers) { 
  const oneEvery = (divNum) => Math.floor(numberOfPlayers / divNum);
  return _.shuffle(_.flatten(_.map(characterCards, (character) => {
    const characterInfo = characterInfoMap.get(character)
    if (characterInfo.onlyOne) {
      return character
    }
    return Array(oneEvery(characterInfo.frequency)).fill(character);
  })));
}

function startingCharacters(settings, numberOfPlayers) {
  const werewolvesPerPlayers = settings.allow_vampires ? 6 : 5
  const werewolvesToAdd = Math.floor(numberOfPlayers/werewolvesPerPlayers) || 1
  const startingCards = [];
  _.forEach(_.range(werewolvesToAdd), () => {
    startingCards.unshift(characters.WEREWOLF)
  })
  
  if (settings.allow_vampires) {
    startingCards.unshift(characters.VAMPIRE)
  }
  if (settings.allow_chaos_demon) {
    startingCards.unshift(characters.CHAOS_DEMON)
  }
  if (settings.random_cards) {
    return startingCards
  }

  startingCards.unshift(
    characters.MASON,
    characters.BODYGUARD,
    characters.SEER,
  )

  let commonCards = [
    characters.MASON,
    characters.LYCAN,
    characters.BAKER,
    characters.HUNTER,
  ]

  if (settings.extra_characters) {
    commonCards.push(
      characters.MUTATED,
      characters.WITCH,
      characters.FOOL,
      characters.DOPPELGANGER,
      characters.APPRENTICE_SEER,
      characters.GROUCHY_GRANNY,
    )
  }

  return _.concat(
    _.shuffle(commonCards),    
    startingCards,
  );
}

async function computeCharacters(numberOfPlayers, guildId) {
  const settings = await findSettings(guildId);
  const playingCards = getCards(settings)

  let werewolfDeck = createDeck(playingCards.wolfCards, numberOfPlayers);
  let villagerDeck = createDeck(playingCards.villagerCards, numberOfPlayers);
  if (settings.random_cards) {
    // make sure seer, bodyguard can be picked
    villagerDeck.concat(characters.SEER, characters.BODYGUARD);
  }

  const balance = new DeckBalancer(settings);
  const cardsInGame = startingCharacters(settings, numberOfPlayers);
  cardsInGame.forEach((character) => balance.addCharacterPoints(character));

  let playersLeftOver = numberOfPlayers - cardsInGame.length;

  if (playersLeftOver <= 0) {
    return cardsInGame;
  }

  _.forEach(_.range(playersLeftOver), () => {
    let newCharacter = characters.VILLAGER
    if (balance.nextTeam() === teams.VILLAGER) {
      newCharacter = _.sample(villagerDeck);
    } else if (balance.nextTeam() === teams.WEREWOLF) {
      newCharacter = _.sample(werewolfDeck);
    }
    const characterInfo = characterInfoMap.get(newCharacter)
    if (characterInfo?.onlyOne) {
      // remove cards that should only have one per game
      if (characterInfo.helpsTeam === teams.VILLAGER) {
        villagerDeck = villagerDeck.filter((c) => c !== newCharacter)
      } else if (characterInfo.helpsTeam === teams.WEREWOLF) {
        werewolfDeck = werewolfDeck.filter((c) => c !== newCharacter)
      }
    }
    cardsInGame.push(balance.addCharacterPoints(newCharacter));
  });

  return _.shuffle(cardsInGame);
}

module.exports = computeCharacters;

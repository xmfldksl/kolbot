/**
*  @filename    Amazon.js
*  @author      kolton, theBGuy
*  @desc        Amazon attack sequence
*
*/

(function (module) {
  module.exports = {
    classid: sdk.player.class.Amazon,
    bowCheck: false,
    lightFuryTick: 0,

    /** @param {Monster} unit */
    decideSkill: function (unit) {
      let skills = { timed: -1, timedSlot: Attack.getPrimarySlot(), untimed: -1, untimedSlot: Attack.getPrimarySlot() };
      if (!unit) return skills;

      let index = (unit.isSpecial || unit.isPlayer) ? 1 : 3;
      let classid = unit.classid;

      // Get timed skill
      let timedEntry = Attack.getCustomAttack(unit) ? Attack.getCustomAttack(unit)[0] : Config.AttackSkill[index];
      let { skill: checkSkill, slot: checkSlot } = Attack.parseSkillEntry(timedEntry);

      if (Attack.checkResist(unit, checkSkill) && Attack.validSpot(unit.x, unit.y, checkSkill, classid)) {
        skills.timed = checkSkill;
        skills.timedSlot = checkSlot;
      } else {
        let { skill: sec5, slot: sec5Slot } = Attack.parseSkillEntry(Config.AttackSkill[5]);
        if (sec5 > -1
          && Attack.checkResist(unit, sec5)
          && Attack.validSpot(unit.x, unit.y, sec5, classid)) {
          skills.timed = sec5;
          skills.timedSlot = sec5Slot;
        }
      }

      // Get untimed skill
      let untimedEntry = Attack.getCustomAttack(unit) ? Attack.getCustomAttack(unit)[1] : Config.AttackSkill[index + 1];
      let { skill: checkUntimed, slot: checkUntimedSlot } = Attack.parseSkillEntry(untimedEntry);

      if (Attack.checkResist(unit, checkUntimed) && Attack.validSpot(unit.x, unit.y, checkUntimed, classid)) {
        skills.untimed = checkUntimed;
        skills.untimedSlot = checkUntimedSlot;
      } else {
        let { skill: sec6, slot: sec6Slot } = Attack.parseSkillEntry(Config.AttackSkill[6]);
        if (sec6 > -1
          && Attack.checkResist(unit, sec6)
          && Attack.validSpot(unit.x, unit.y, sec6, classid)) {
          skills.untimed = sec6;
          skills.untimedSlot = sec6Slot;
        }
      }

      // Low mana timed skill
      if (Config.LowManaSkill[0] > -1
        && Skill.getManaCost(skills.timed) > me.mp) {
        let { skill: lmTimed, slot: lmTimedSlot } = Attack.parseSkillEntry(Config.LowManaSkill[0]);
        if (Attack.checkResist(unit, lmTimed)) {
          skills.timed = lmTimed;
          skills.timedSlot = lmTimedSlot;
        }
      }

      // Low mana untimed skill
      if (Config.LowManaSkill[1] > -1
        && Skill.getManaCost(skills.untimed) > me.mp) {
        let { skill: lmUntimed, slot: lmUntimedSlot } = Attack.parseSkillEntry(Config.LowManaSkill[1]);
        if (Attack.checkResist(unit, lmUntimed)) {
          skills.untimed = lmUntimed;
          skills.untimedSlot = lmUntimedSlot;
        }
      }

      return skills;
    },

    /**
    * @param {Monster | Player} unit 
    * @param {boolean} [preattack] 
    * @returns {AttackResult}
    */
    doAttack: function (unit, preattack) {
      if (!unit) return Attack.Result.SUCCESS;
      Config.TeleSwitch && me.switchToPrimary();
      let gid = unit.gid;
      let needRepair = me.needRepair();

      if ((Config.MercWatch && me.needMerc()) || needRepair.length > 0) {
        console.log("towncheck");

        if (Town.visitTown(!!needRepair.length)) {
          // lost reference to the mob we were attacking
          if (!unit || !copyUnit(unit).x || !Game.getMonster(-1, -1, gid) || unit.dead) {
            return Attack.Result.SUCCESS;
          }
        }
      }

      if (Config.ChargeCast.skill > -1) {
        Attack.doChargeCast(unit);
      }

      if (preattack) {
        let preAttackResult = Attack.doPreAttack(unit);
        if (preAttackResult !== Attack.Result.NOOP) {
          return preAttackResult;
        }
      }

      if (Skill.canUse(sdk.skills.InnerSight)) {
        if (!unit.getState(sdk.states.InnerSight)
          && unit.distance > 3 && unit.distance < 13
          && !checkCollision(me, unit, sdk.collision.Ranged)) {
          Skill.cast(sdk.skills.InnerSight, sdk.skills.hand.Right, unit);
        }
      }

      if (Skill.canUse(sdk.skills.SlowMissiles)) {
        if (!unit.getState(sdk.states.SlowMissiles)) {
          if ((unit.distance > 3 || unit.getEnchant(sdk.enchant.LightningEnchanted))
            && unit.distance < 13 && !checkCollision(me, unit, sdk.collision.Ranged)) {
            // Act Bosses and mini-bosses are immune to Slow Missles and pointless to use on lister or Cows, Use Inner-Sight instead
            if ([sdk.monsters.HellBovine].includes(unit.classid) || unit.isBoss) {
              // Check if already in this state
              if (!unit.getState(sdk.states.InnerSight) && Config.UseInnerSight && Skill.canUse(sdk.skills.InnerSight)) {
                Skill.cast(sdk.skills.InnerSight, sdk.skills.hand.Right, unit);
              }
            } else {
              Skill.cast(sdk.skills.SlowMissiles, sdk.skills.hand.Right, unit);
            }
          }
        }
      }

      let mercRevive = 0;
      let skills = this.decideSkill(unit);
      let result = this.doCast(unit, skills.timed, skills.timedSlot, skills.untimed, skills.untimedSlot);

      if (result === Attack.Result.CANTATTACK && Attack.canTeleStomp(unit)) {
        let merc = me.getMerc();

        while (unit.attackable) {
          if (!unit || !copyUnit(unit).x) {
            unit = Misc.poll(() => Game.getMonster(-1, -1, gid), 1000, 80);
          }
          if (!unit) return Attack.Result.SUCCESS;

          if (me.needMerc()) {
            if (Config.MercWatch && mercRevive++ < 1) {
              Town.visitTown();
            } else {
              return Attack.Result.CANTATTACK;
            }

            (merc === undefined || !merc) && (merc = me.getMerc());
          }

          if (!!merc && getDistance(merc, unit) > 5) {
            Pather.moveToUnit(unit);

            let spot = Attack.findSafeSpot(unit, 10, 5, 9);
            !!spot && !!spot.x && Pather.walkTo(spot.x, spot.y);
          }

          let closeMob = Attack.getNearestMonster({ skipGid: gid });
          
          if (!!closeMob) {
            let findSkill = this.decideSkill(closeMob);
            if (this.doCast(closeMob, findSkill.timed, findSkill.timedSlot, findSkill.untimed, findSkill.untimedSlot) !== Attack.Result.SUCCESS) {
              (Skill.canUse(sdk.skills.Decoy) && Skill.cast(sdk.skills.Decoy, sdk.skills.hand.Right, unit));
            }
          }
        }

        return Attack.Result.SUCCESS;
      }

      return result;
    },

    afterAttack: function () {
      Precast.doPrecast(false);

      let needRepair = (me.needRepair() || []);

      // Repair check, mainly to restock arrows
      needRepair.length > 0 && Town.visitTown(true);

      this.lightFuryTick = 0;
    },

    /**
    * @param {Monster | Player} unit
    * @param {number} timedSkill
    * @param {number} timedSlot
    * @param {number} untimedSkill
    * @param {number} untimedSlot
    * @returns {AttackResult} 0 - fail, 1 - success, 2 - no valid attack skills
    */
    doCast: function (unit, timedSkill = -1, timedSlot = Attack.getPrimarySlot(), untimedSkill = -1, untimedSlot = Attack.getPrimarySlot()) {
      // No valid skills can be found
      if (timedSkill < 0 && untimedSkill < 0) return Attack.Result.CANTATTACK;
      // unit became invalidated
      if (!unit || !unit.attackable) return Attack.Result.SUCCESS;
      Config.TeleSwitch && me.switchToPrimary();
      
      // Arrow/bolt check
      const bowCheck = Attack.usingBow();
      if (bowCheck) {
        switch (true) {
        case bowCheck === "bow" && !me.getItem("aqv", sdk.items.mode.Equipped):
        case bowCheck === "crossbow" && !me.getItem("cqv", sdk.items.mode.Equipped):
          console.log("Bow check");
          Town.visitTown();

          break;
        }
      }

      let walk;

      if (timedSkill > -1 && (!me.skillDelay || !Skill.isTimed(timedSkill))) {
        switch (timedSkill) {
        case sdk.skills.LightningFury:
          if (!this.lightFuryTick || getTickCount() - this.lightFuryTick > Config.LightningFuryDelay * 1000) {
            if (unit.distance > Skill.getRange(timedSkill) || checkCollision(me, unit, sdk.collision.Ranged)) {
              if (!Attack.getIntoPosition(unit, Skill.getRange(timedSkill), sdk.collision.Ranged)) {
                return Attack.Result.FAILED;
              }
            }

            if (!unit.dead) {
              me.weaponswitch !== timedSlot && me.switchWeapons(timedSlot);
              if (Skill.cast(timedSkill, Skill.getHand(timedSkill), unit)) {
                ClassAttack.lightFuryTick = getTickCount();
              }
            }

            return Attack.Result.SUCCESS;
          }

          break;
        default:
          if (Skill.getRange(timedSkill) < 4 && !Attack.validSpot(unit.x, unit.y, timedSkill, unit.classid)) {
            return Attack.Result.FAILED;
          }

          if (unit.distance > Skill.getRange(timedSkill) || checkCollision(me, unit, sdk.collision.Ranged)) {
            // Allow short-distance walking for melee skills
            walk = (Skill.getRange(timedSkill) < 4
              && unit.distance < 10
              && !checkCollision(me, unit, sdk.collision.BlockWall)
            );

            if (!Attack.getIntoPosition(unit, Skill.getRange(timedSkill), sdk.collision.Ranged, walk)) {
              return Attack.Result.FAILED;
            }
          }

          if (!unit.dead) {
            me.weaponswitch !== timedSlot && me.switchWeapons(timedSlot);
            Skill.cast(timedSkill, Skill.getHand(timedSkill), unit);
          }

          return Attack.Result.SUCCESS;
        }
      }

      if (untimedSkill > -1) {
        if (Skill.getRange(untimedSkill) < 4 && !Attack.validSpot(unit.x, unit.y, untimedSkill, unit.classid)) {
          return Attack.Result.FAILED;
        }

        if (unit.distance > Skill.getRange(untimedSkill) || checkCollision(me, unit, sdk.collision.Ranged)) {
          // Allow short-distance walking for melee skills
          walk = (Skill.getRange(untimedSkill) < 4
            && unit.distance < 10
            && !checkCollision(me, unit, sdk.collision.BlockWall)
          );

          if (!Attack.getIntoPosition(unit, Skill.getRange(untimedSkill), sdk.collision.Ranged, walk)) {
            return Attack.Result.FAILED;
          }
        }

        if (!unit.dead) {
          me.weaponswitch !== untimedSlot && me.switchWeapons(untimedSlot);
          Skill.cast(untimedSkill, Skill.getHand(untimedSkill), unit);
        }

        return Attack.Result.SUCCESS;
      }

      Misc.poll(() => !me.skillDelay, 1000, 40);

      // Wait for Lightning Fury timeout
      while (timedSkill === sdk.skills.LightningFury
        && this.lightFuryTick && getTickCount() - this.lightFuryTick < Config.LightningFuryDelay * 1000) {
        delay(40);
      }

      return Attack.Result.SUCCESS;
    }
  };
})(module);

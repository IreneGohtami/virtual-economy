import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Recipe } from './recipe.entity';
import { Commodity } from './commodity.entity';

@Entity('recipe_inputs')
@Index('idx_recipe_inputs_recipe', ['recipeId'])
export class RecipeInput {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'recipe_id', type: 'uuid' })
  recipeId!: string;

  @Column({ name: 'commodity_id', type: 'uuid' })
  commodityId!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @ManyToOne(() => Recipe, (recipe) => recipe.inputs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipe_id' })
  recipe!: Recipe;

  @ManyToOne(() => Commodity, (commodity) => commodity.recipeInputs)
  @JoinColumn({ name: 'commodity_id' })
  commodity!: Commodity;
}
